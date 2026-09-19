import { Store } from '../../state/Store';
import { tokensSchema, userSchema, type User } from '../../models/contracts';
import { ApiClient, ApiError } from '../../services/api/ApiClient';
import type { TokenVault } from '../../services/storage/TokenVault';
export type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn' | 'unavailable';
  user: User | null;
  error?: string;
};
export class AuthStore extends Store<AuthState> {
  private generation = 0;
  constructor(readonly api: ApiClient, private vault: TokenVault) {
    super({ status: 'loading', user: null });
    api.onUnauthorized = () => {
      this.generation++;
      this.publish({ status: 'signedOut', user: null });
    };
  }
  async restore() {
    const generation = ++this.generation;
    this.publish({ status: 'loading', user: null });
    try {
      if (!(await this.vault.read())) {
        if (generation === this.generation) {
          this.publish({ status: 'signedOut', user: null });
        }
        return;
      }
      const user = userSchema.parse(await this.api.request('GET', '/me'));
      if (generation === this.generation) {
        this.publish({ status: 'signedIn', user });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.publish({
          status:
            error instanceof ApiError && error.status === 401
              ? 'signedOut'
              : 'unavailable',
          user: null,
          error:
            'Account service unavailable. Your stored session is retained; retry when connected.',
        });
      }
    }
  }
  async authenticate(email: string, password: string, fullName?: string) {
    const generation = ++this.generation;
    this.api.invalidateSession();
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
  async logout() {
    const generation = ++this.generation;
    this.api.invalidateSession();
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
}
