import { sanitizeRestrictionDiagnostic } from '../../features/routing/restrictionDiagnostic';
import { safeDriverError } from '../../errors/driverErrors';
import { tokensSchema } from '../../models/contracts';
import type { TokenVault } from '../storage/TokenVault';
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly retryable = false,
    readonly validationFields: string[] = [],
    readonly restrictionDiagnostic: ReturnType<
      typeof sanitizeRestrictionDiagnostic
    > = null,
  ) {
    super(message);
  }
}
type Reply = { status: number; ok: boolean; text: string };
export class ApiClient {
  private refreshFlight: Promise<boolean> | null = null;
  private sessionGeneration = 0;
  onUnauthorized: () => void = () => {};
  constructor(
    private baseUrl: string,
    private vault: TokenVault,
    private transport: typeof fetch = fetch,
  ) {}
  invalidateSession() {
    this.sessionGeneration++;
    this.refreshFlight = null;
  }
  /** App-private file bytes; authorization follows the same session/refresh boundary. */
  async uploadDocument(
    path: string,
    uri: string,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !/^\/documents\/[^/]+\/attachments\/[a-f0-9-]+\/bytes$/.test(path) ||
      !uri.startsWith('file://')
    )
      throw new ApiError('INVALID_PATH', 'Invalid document upload.');
    const generation = this.sessionGeneration;
    const send = async () => {
      const tokens = await this.vault.read();
      if (generation !== this.sessionGeneration || !tokens)
        throw new ApiError('SESSION_CHANGED', 'Sign in again.');
      return new Promise<number>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = (action: () => void) => {
          signal?.removeEventListener('abort', abort);
          action();
        };
        xhr.open('PUT', this.baseUrl + path);
        xhr.timeout = 90000;
        xhr.setRequestHeader('Authorization', 'Bearer ' + tokens.accessToken);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = event => {
          if (generation === this.sessionGeneration && event.lengthComputable)
            onProgress(
              Math.min(100, Math.floor((event.loaded / event.total) * 100)),
            );
        };
        xhr.onload = () => finish(() => resolve(xhr.status));
        xhr.onerror = () =>
          finish(() =>
            reject(
              new ApiError(
                'NETWORK_UNAVAILABLE',
                'Upload failed. Retry when connected.',
              ),
            ),
          );
        xhr.ontimeout = () =>
          finish(() =>
            reject(
              new ApiError(
                'REQUEST_TIMEOUT',
                'Upload timed out. Retry when connected.',
              ),
            ),
          );
        xhr.onabort = () =>
          finish(() =>
            reject(new ApiError('REQUEST_CANCELLED', 'Upload cancelled.')),
          );
        signal?.addEventListener('abort', abort);
        if (signal?.aborted) {
          finish(() =>
            reject(new ApiError('REQUEST_CANCELLED', 'Upload cancelled.')),
          );
          return;
        }
        // React Native's native networking accepts URI bodies without base64 in JS.
        xhr.send({ uri } as unknown as Parameters<XMLHttpRequest['send']>[0]);
      });
    };
    let status = await send();
    if (generation !== this.sessionGeneration)
      throw new ApiError('SESSION_CHANGED', 'Session changed.');
    if (status === 401 && (await this.refresh())) status = await send();
    if (generation !== this.sessionGeneration)
      throw new ApiError('SESSION_CHANGED', 'Session changed.');
    if (status === 401) {
      this.invalidateSession();
      await this.vault.clear();
      this.onUnauthorized();
    }
    if (status < 200 || status >= 300)
      throw new ApiError(
        'DOCUMENT_UPLOAD_FAILED',
        'Upload could not be confirmed. Retry.',
        status,
      );
  }
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    authenticated = true,
    onRouteResponse?: (status: number) => void,
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new ApiError('INVALID_PATH', 'Invalid API path.');
    }
    const observeRouteResponse = (status: number) => {
      if (method === 'POST' && path === '/routing/truck-route') {
        try {
          onRouteResponse?.(status);
        } catch {
          /* Observability cannot change requests. */
        }
      }
    };
    const generation = this.sessionGeneration;
    const tokens = authenticated ? await this.vault.read() : null;
    if (authenticated && generation !== this.sessionGeneration) {
      throw new ApiError('SESSION_CHANGED', 'Session changed.');
    }
    let response = await this.send(
      method,
      path,
      body,
      tokens?.accessToken,
      signal,
    );
    observeRouteResponse(response.status);
    if (authenticated && generation !== this.sessionGeneration) {
      throw new ApiError('SESSION_CHANGED', 'Session changed.');
    }
    if (authenticated && response.status === 401 && tokens?.refreshToken) {
      const latest = await this.vault.read();
      const refreshed =
        latest !== null && latest.accessToken !== tokens.accessToken
          ? true
          : await this.refresh();
      if (refreshed && generation === this.sessionGeneration) {
        const retryTokens = await this.vault.read();
        if (generation !== this.sessionGeneration || !retryTokens)
          throw new ApiError('SESSION_CHANGED', 'Session changed.');
        response = await this.send(
          method,
          path,
          body,
          retryTokens.accessToken,
          signal,
        );
        observeRouteResponse(response.status);
      }
    }
    if (authenticated && generation !== this.sessionGeneration) {
      throw new ApiError('SESSION_CHANGED', 'Session changed.');
    }
    if (response.status === 401 && authenticated) {
      this.invalidateSession();
      await this.vault.clear();
      this.onUnauthorized();
    }
    let data: unknown;
    try {
      data = response.text ? JSON.parse(response.text) : null;
    } catch {
      if (!response.ok) {
        const code =
          response.status === 401
            ? 'AUTH_EXPIRED'
            : response.status === 502
            ? 'PROVIDER_UNAVAILABLE'
            : 'REQUEST_FAILED';
        throw new ApiError(
          code,
          safeDriverError({ code, status: response.status }),
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }
      throw new ApiError(
        'INVALID_RESPONSE',
        'Invalid server response.',
        response.status,
      );
    }
    if (!response.ok) {
      const error =
        data && typeof data === 'object' && 'error' in data
          ? (data as { error: unknown }).error
          : null;
      const detail =
        error && typeof error === 'object'
          ? (error as {
              code?: unknown;
              message?: unknown;
              retryable?: unknown;
              restrictionDiagnostic?: unknown;
              details?: { fieldErrors?: unknown };
            })
          : {};
      throw new ApiError(
        typeof detail.code === 'string' ? detail.code : 'REQUEST_FAILED',
        safeDriverError({ code: detail.code, status: response.status }),
        response.status,
        typeof detail.retryable === 'boolean'
          ? detail.retryable
          : response.status === 429 || response.status >= 500,
        detail.code === 'VALIDATION_ERROR' &&
        detail.details?.fieldErrors &&
        typeof detail.details.fieldErrors === 'object'
          ? Object.keys(detail.details.fieldErrors).slice(0, 50)
          : [],
        detail.code === 'TRIMBLE_RESTRICTION_WARNING'
          ? sanitizeRestrictionDiagnostic(detail.restrictionDiagnostic)
          : null,
      );
    }
    return data as T;
  }
  /** Revoke only the captured session; never refresh or read a newer login. */
  async revokeSession(tokens: { accessToken: string; refreshToken: string }) {
    const response = await this.send(
      'POST',
      '/auth/logout',
      { refreshToken: tokens.refreshToken },
      tokens.accessToken,
    );
    if (!response.ok)
      throw new ApiError(
        'LOGOUT_REVOKE_FAILED',
        'Remote sign-out could not be confirmed.',
        response.status,
      );
  }
  private async send(
    method: string,
    path: string,
    body?: unknown,
    access?: string,
    signal?: AbortSignal,
  ): Promise<Reply> {
    if (signal?.aborted)
      throw new ApiError('REQUEST_CANCELLED', 'The request was cancelled.');
    const controller = new AbortController();
    let rejectInterrupted!: (error: Error) => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterrupted = reject;
    });
    const abort = () => {
      controller.abort();
      rejectInterrupted(
        new ApiError('REQUEST_CANCELLED', 'The request was cancelled.'),
      );
    };
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      controller.abort();
      rejectInterrupted(
        new ApiError(
          'REQUEST_TIMEOUT',
          'SemiTraX took too long to respond.',
          0,
          true,
        ),
      );
    }, 20000);
    try {
      return await Promise.race([
        interrupted,
        (async () => {
          const response = await this.transport(this.baseUrl + path, {
            method,
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              ...(body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
              ...(access ? { Authorization: 'Bearer ' + access } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          });
          const text = await response.text();
          if (text.length > 20_000_000)
            throw new ApiError(
              'INVALID_RESPONSE',
              'SemiTraX returned an oversized response.',
              response.status,
            );
          return { status: response.status, ok: response.ok, text };
        })(),
      ]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        signal?.aborted
          ? 'REQUEST_CANCELLED'
          : controller.signal.aborted
          ? 'REQUEST_TIMEOUT'
          : 'NETWORK_UNAVAILABLE',
        'Unable to reach SemiTraX. Check your connection and retry.',
        0,
        !signal?.aborted,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  private refresh() {
    if (this.refreshFlight) {
      return this.refreshFlight;
    }
    const flight = this.performRefresh().finally(() => {
      if (this.refreshFlight === flight) {
        this.refreshFlight = null;
      }
    });
    this.refreshFlight = flight;
    return flight;
  }
  private async performRefresh(): Promise<boolean> {
    const generation = this.sessionGeneration;
    const tokens = await this.vault.read();
    if (!tokens) {
      return false;
    }
    const response = await this.send('POST', '/auth/refresh', {
      refreshToken: tokens.refreshToken,
    });
    if (generation !== this.sessionGeneration) {
      return false;
    }
    if (response.status === 401 || response.status === 400) {
      this.invalidateSession();
      await this.vault.clear();
      this.onUnauthorized();
      return false;
    }
    if (!response.ok) {
      throw new ApiError(
        'REFRESH_UNAVAILABLE',
        'Session refresh is temporarily unavailable. Retry when connected.',
        response.status,
        true,
      );
    }
    let next;
    try {
      next = tokensSchema.parse(JSON.parse(response.text));
    } catch {
      throw new ApiError(
        'INVALID_RESPONSE',
        'The session response could not be validated.',
        response.status,
      );
    }
    if (generation !== this.sessionGeneration) {
      return false;
    }
    await this.vault.write(next);
    return generation === this.sessionGeneration;
  }
}
