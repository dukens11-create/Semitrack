import * as Keychain from 'react-native-keychain';
import { z } from 'zod';

const bodySchema = z
  .object({
    createOperationId: z.string().uuid(),
    type: z.string().min(1),
    fileName: z.string().max(150),
    issuedOn: z.string().nullable(),
    expiresOn: z.string().nullable(),
    truckId: z.string().nullable(),
  })
  .strict();
export type PendingDocumentBody = z.infer<typeof bodySchema>;
export interface DocumentOperationStorage {
  read(owner: string): Promise<string | null>;
  write(owner: string, value: string): Promise<void>;
  clear(owner: string): Promise<void>;
}
const options = (owner: string) => ({
  service: 'com.semitrax.app.document-create.' + encodeURIComponent(owner),
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
const secureStorage: DocumentOperationStorage = {
  async read(owner) {
    const value = await Keychain.getGenericPassword(options(owner));
    return value ? value.password : null;
  },
  async write(owner, value) {
    if (
      !(await Keychain.setGenericPassword(
        'pending-document',
        value,
        options(owner),
      ))
    )
      throw new Error('Secure document recovery storage unavailable.');
  },
  async clear(owner) {
    await Keychain.resetGenericPassword(options(owner));
  },
};
/** One unresolved create per owner; persisted before HTTP. Never stores credentials. */
export class PendingDocumentCreates {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private storage: DocumentOperationStorage = secureStorage) {}
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.catch(() => {});
    return result;
  }
  private async readStored(owner: string) {
    if (!owner) throw new Error('Sign in before recovering a document save.');
    const value = await this.storage.read(owner);
    if (value === null) return null;
    const record = z
      .object({ owner: z.literal(owner), body: bodySchema })
      .strict()
      .parse(JSON.parse(value));
    return record.body;
  }
  read(owner: string) {
    return this.enqueue(() => this.readStored(owner));
  }
  begin(owner: string, input: PendingDocumentBody) {
    return this.enqueue(async () => {
      const pending = await this.readStored(owner);
      if (pending) return pending;
      const body = bodySchema.parse(input);
      await this.storage.write(owner, JSON.stringify({ owner, body }));
      return body;
    });
  }
  complete(owner: string, operation: string) {
    return this.enqueue(async () => {
      const pending = await this.readStored(owner);
      if (pending?.createOperationId === operation)
        await this.storage.clear(owner);
    });
  }
}
export const pendingDocumentCreates = new PendingDocumentCreates();
