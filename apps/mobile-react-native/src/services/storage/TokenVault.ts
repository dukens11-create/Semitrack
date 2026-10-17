import type { Tokens } from '../../models/contracts';
export interface TokenVault {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}
