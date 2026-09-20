import { Store } from '../../state/Store';
import { tokensSchema, userSchema, type User } from '../../models/contracts';
import { ApiClient, ApiError } from '../../services/api/ApiClient';
import type { TokenVault } from '../../services/storage/TokenVault';
import type { OfflineAccess, OfflineView } from '../offline/OfflineAccess';
export type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn' | 'unavailable' | 'offline';
  user: User | null;
  error?: string;
  offline?: OfflineView;
};
export class AuthStore extends Store<AuthState> {
  private generation = 0;
  constructor(readonly api: ApiClient, private vault: TokenVault, private offlineAccess?: OfflineAccess,
    private erasePersonalDeviceData?: (owner: string) => Promise<void>) {
    super({ status: 'loading', user: null });
    api.onUnauthorized = () => {
      this.generation++;
      void this.offlineAccess?.clear().catch(() => {});
      this.publish({ status: 'signedOut', user: null });
    };
  }
  async restore() {
    const generation = ++this.generation;
    this.publish({ status: 'loading', user: null });
    try {
      if (!(await this.vault.read())) {
        await this.offlineAccess?.clear().catch(() => {});
        if (generation === this.generation) {
          this.publish({ status: 'signedOut', user: null });
        }
        return;
      }
      const user = userSchema.parse(await this.api.request('GET', '/me'));
      if (generation === this.generation)
        await this.offlineAccess?.confirm(user.id).catch(() => {});
      if (generation === this.generation) {
        this.publish({ status: 'signedIn', user });
      }
    } catch (error) {
      const recoverable = error instanceof ApiError &&
        ['NETWORK_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(error.code);
      const offline = recoverable && generation === this.generation
        ? await this.offlineAccess?.read() : null;
      if (generation === this.generation) {
        this.publish({
          status:
            error instanceof ApiError && error.status === 401
              ? 'signedOut'
              : 'unavailable',
          user: null,
          ...(offline ? { offline } : {}),
          error:
            'Account service unavailable. Your stored session is retained; retry when connected.',
        });
      }
    }
  }
  async authenticate(email: string, password: string, fullName?: string) {
    const generation = ++this.generation;
    this.api.invalidateSession();
    await this.offlineAccess?.clear().catch(() => {});
    const response = await this.api.request<Record<string, unknown>>(
      'POST',
      fullName !== undefined ? '/auth/register' : '/auth/login',
      {
        email: email.trim(),
        password,
        ...(fullName !== undefined ? { fullName: fullName.trim() } : {}),
      },
      undefined,
      false,
    );
    const user = userSchema.parse(response.user),
      tokens = tokensSchema.parse(response);
    if (generation !== this.generation) {
      return;
    }
    await this.vault.write(tokens);
    if (generation === this.generation)
      await this.offlineAccess?.confirm(user.id).catch(() => {});
    if (generation === this.generation) {
      this.publish({ status: 'signedIn', user });
    }
  }
  async requestPasswordReset(email: string) {
    await this.api.request(
      'POST',
      '/auth/password-reset/request',
      { email: email.trim() },
      undefined,
      false,
    );
  }
  async updateProfile(fullName: string, phone: string | null) {
    const generation = this.generation;
    const user = userSchema.parse(
      await this.api.request('PATCH', '/me', { fullName, phone }),
    );
    if (generation === this.generation) {
      this.publish({ status: 'signedIn', user });
    }
  }
  async changePassword(currentPassword: string, password: string) {
    const generation = this.generation;
    await this.api.request('POST', '/auth/password/change', {
      currentPassword,
      password,
    });
    if (generation === this.generation) await this.logout();
  }
  async confirmPasswordReset(token: string, password: string) {
    await this.api.request(
      'POST',
      '/auth/password-reset/confirm',
      { token, password },
      undefined,
      false,
    );
  }
  async deleteAccount(currentPassword: string, confirmation: string) {
    if (this.value.status !== 'signedIn' || !this.value.user || confirmation !== 'DELETE MY ACCOUNT')
      throw new Error('Sign in and confirm account deletion.');
    const generation = this.generation;
    const owner = this.value.user.id;
    const result = await this.api.request<{deleted?: boolean}>('DELETE', '/me', {
      currentPassword, confirmation,
    });
    if (result?.deleted !== true) throw new Error('Account deletion was not confirmed.');
    try {
      await this.erasePersonalDeviceData?.(owner);
    } finally {
      if (generation === this.generation) await this.logout();
    }
  }
  async logout() {
    const generation = ++this.generation;
    this.api.invalidateSession();
    await this.offlineAccess?.clear().catch(() => {});
    const tokens = await this.vault.read();
    if (generation !== this.generation) {
      return;
    }
    await this.vault.clear();
    if (generation === this.generation) {
      this.publish({ status: 'signedOut', user: null });
    }
    if (tokens) {
      try {
        await this.api.revokeSession(tokens);
      } catch {
        /* Offline local sign-out is still complete. */
      }
    }
  }
  async openOffline() {
    if (this.value.status !== 'unavailable' || !this.value.offline) return;
    const generation = this.generation;
    const offline = await this.offlineAccess?.read();
    if (offline && generation === this.generation && this.value.status === 'unavailable')
      this.publish({ status: 'offline', user: null, offline });
  }
  closeOffline() {
    if (this.value.status === 'offline')
      this.publish({ status: 'unavailable', user: null, offline: this.value.offline,
        error: 'Reconnect to verify your account before using online features.' });
  }
  async recheckOffline() {
    if (this.value.status !== 'offline') return;
    const generation = this.generation;
    const offline = await this.offlineAccess?.read();
    if (generation !== this.generation || this.value.status !== 'offline') return;
    if (offline) this.publish({ status: 'offline', user: null, offline });
    else this.publish({ status: 'unavailable', user: null,
      error: 'Offline access expired or is unavailable. Reconnect to verify your account.' });
  }
}
