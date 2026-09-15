import type { Environment } from './environment';

/** Public diagnostics for controlled debug APKs; never log response bodies or credentials. */
export async function reportRuntimeConfiguration(environment: Environment) {
  console.info(
    '[SemiTraX configuration]',
    JSON.stringify({ apiUrl: environment.apiUrl }),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(environment.apiUrl + '/health', {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    const health =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    console.info(
      '[SemiTraX health]',
      JSON.stringify({
        httpStatus: response.status,
        status: health.status === 'ok' ? 'ok' : 'not-ok',
        database: health.database === 'ok' ? 'ok' : 'not-ok',
      }),
    );
  } catch {
    console.warn('[SemiTraX health] Public health check unavailable.');
  } finally {
    clearTimeout(timer);
  }
}
