import * as Keychain from 'react-native-keychain';
import { z } from 'zod';
import { Store } from '../../state/Store';
import type { ApiClient } from '../../services/api/ApiClient';
import {
  localFileSchema,
  validateDocumentFiles,
  documentMessage,
} from './DocumentFiles';
const metadata = z.object({
  createOperationId: z.string().uuid(),
  type: z.string(),
  fileName: z.string().min(1).max(150),
  issuedOn: z.string().nullable(),
  expiresOn: z.string().nullable(),
  truckId: z.string().nullable(),
});
const draft = z.object({
  id: z.string().uuid(),
  body: metadata,
  documentId: z.string().optional(),
  replaceId: z.string().optional(),
  files: z.array(
    localFileSchema.extend({
      serverId: z.string().optional(),
      complete: z.boolean().default(false),
    }),
  ),
  state: z.enum(['PENDING', 'UPLOADING', 'COMPLETE', 'FAILED']),
  attempts: z.number().int().nonnegative(),
  nextAttempt: z.number(),
  error: z.string().optional(),
});
export type DocumentDraft = z.infer<typeof draft>;
export interface QueueStorage {
  read(owner: string): Promise<string | null>;
  write(owner: string, value: string): Promise<void>;
}
const options = (owner: string) => ({
  service: 'com.semitrax.app.document-files.' + encodeURIComponent(owner),
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
const secure: QueueStorage = {
  async read(owner) {
    const value = await Keychain.getGenericPassword(options(owner));
    return value ? value.password : null;
  },
  async write(owner, value) {
    if (
      !(await Keychain.setGenericPassword(
        'document-files',
        value,
        options(owner),
      ))
    )
      throw new Error('Secure local document storage unavailable.');
  },
};
const deletedOwners = new Set<string>();
export async function discardDocumentQueue(owner: string) {
  if (!owner) throw new Error('Account owner required.');
  deletedOwners.add(owner);
  await Keychain.resetGenericPassword(options(owner));
}
/** Manifest only in Keychain; bytes remain in owner-scoped app-private files. */
export class DocumentUploadQueue extends Store<{
  items: DocumentDraft[];
  progress: number | null;
}> {
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  private uploading = false;
  constructor(
    readonly owner: string,
    private api: ApiClient,
    private current: () => boolean,
    private storage: QueueStorage = secure,
  ) {
    super({ items: [], progress: null });
  }
  private serial<T>(fn: () => Promise<T>) {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
  private guard() {
    if (!this.owner || deletedOwners.has(this.owner) || !this.current())
      throw new Error('Session changed.');
  }
  async load() {
    return this.serial(async () => {
      this.guard();
      if (this.loaded) return;
      const raw = await this.storage.read(this.owner);
      this.guard();
      const items = raw ? z.array(draft).parse(JSON.parse(raw)) : [];
      this.publish({
        items: items.map(item =>
          item.state === 'UPLOADING' ? { ...item, state: 'PENDING' } : item,
        ),
        progress: null,
      });
      this.loaded = true;
    });
  }
  private async persist(items: DocumentDraft[]) {
    this.guard();
    await this.storage.write(this.owner, JSON.stringify(items));
    this.guard();
    this.publish({ ...this.value, items });
  }
  async save(input: DocumentDraft) {
    await this.load();
    return this.serial(async () => {
      this.guard();
      if (this.uploading) throw new Error('Wait for the upload to finish.');
      const item = draft.parse(input);
      validateDocumentFiles(item.files);
      await this.persist([
        ...this.value.items.filter(i => i.id !== item.id),
        item,
      ]);
    });
  }
  async discard(id: string) {
    await this.load();
    return this.serial(async () => {
      if (this.uploading) throw new Error('Wait for upload.');
      await this.persist(this.value.items.filter(i => i.id !== id));
    });
  }
  private async update(id: string, change: Partial<DocumentDraft>) {
    return this.serial(async () => {
      const item = this.value.items.find(i => i.id === id);
      if (!item) throw new Error('Pending document missing.');
      await this.persist(
        this.value.items.map(i => (i.id === id ? { ...i, ...change } : i)),
      );
      return this.value.items.find(i => i.id === id)!;
    });
  }
  async upload(id: string) {
    await this.load();
    if (this.uploading) throw new Error('An upload is already in progress.');
    let item = this.value.items.find(i => i.id === id);
    if (!item || item.state === 'COMPLETE') return;
    if (!item.files.length)
      throw new Error('Select a document file before uploading.');
    this.guard();
    if (Date.now() < item.nextAttempt)
      throw new Error('Wait briefly before retrying this upload.');
    this.uploading = true;
    try {
      const capability = z
        .object({ storageAvailable: z.boolean() })
        .parse(await this.api.request('GET', '/documents/capabilities'));
      if (!capability.storageAvailable)
        throw { code: 'DOCUMENT_STORAGE_NOT_CONFIGURED' };
      this.guard();
      item = await this.update(id, { state: 'UPLOADING', error: undefined });
      if (!item.documentId) {
        const record = z
          .object({ id: z.string().min(1) })
          .parse(await this.api.request('POST', '/documents', item.body));
        this.guard();
        item = await this.update(id, { documentId: record.id });
      }
      for (let index = 0; index < item.files.length; index++) {
        this.guard();
        let file = item.files[index]!;
        if (file.complete) continue;
        const root = '/documents/' + encodeURIComponent(item.documentId!);
        if (!file.serverId) {
          const session = z.object({ id: z.string().uuid() }).parse(
            await this.api.request('POST', root + '/upload-init', {
              operationId: file.id,
              originalFilename: file.originalFilename,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              checksum: file.checksum,
              replaceId: item.replaceId,
            }),
          );
          this.guard();
          file = { ...file, serverId: session.id };
          item = await this.update(id, {
            files: item.files.map((f, i) => (i === index ? file : f)),
          });
        }
        await this.api.uploadDocument(
          root + '/attachments/' + file.serverId + '/bytes',
          file.uri,
          percent => {
            if (this.current())
              this.publish({ ...this.value, progress: percent });
          },
        );
        this.guard();
        const complete = z.object({ status: z.literal('SAVED') }).parse(
          await this.api.request('POST', root + '/upload-complete', {
            attachmentId: file.serverId,
          }),
        );
        void complete;
        item = await this.update(id, {
          files: item.files.map((f, i) =>
            i === index ? { ...f, complete: true } : f,
          ),
        });
      }
      await this.update(id, { state: 'COMPLETE', error: undefined });
    } catch (error) {
      if (this.current() && item) {
        await this.update(id, {
          state: 'FAILED',
          attempts: item.attempts + 1,
          nextAttempt:
            Date.now() +
            Math.min(300000, 1000 * 2 ** Math.min(item.attempts, 8)),
          error: documentMessage(error),
        });
      }
      throw error;
    } finally {
      this.uploading = false;
      if (this.current()) this.publish({ ...this.value, progress: null });
    }
  }
}
