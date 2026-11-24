import type { Tokens } from '../../models/contracts';
import type { TokenVault } from './TokenVault';
/** Serialize native secure storage so sign-out cannot overtake a pending write. */
export class SerializedTokenVault implements TokenVault {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private vault: TokenVault) {}
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.catch(() => {});
    return result;
  }
  read() {
    return this.enqueue(() => this.vault.read());
  }
  write(tokens: Tokens) {
    return this.enqueue(() => this.vault.write(tokens));
  }
  clear() {
    return this.enqueue(() => this.vault.clear());
  }
}
