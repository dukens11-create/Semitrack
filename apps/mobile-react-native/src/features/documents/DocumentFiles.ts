import { Platform } from 'react-native';
import { z } from 'zod';
import NativePlatform from '../../native/navigation/NativeSemiTraxPlatform';
export {
  DOCUMENT_FILE_LIMITS,
  validateDocumentFile,
  validateDocumentFiles,
} from '../../../../api/src/contracts/documentFiles';
import { DOCUMENT_FILE_LIMITS } from '../../../../api/src/contracts/documentFiles';
export const localFileSchema = z.object({
  id: z.string().uuid(),
  uri: z.string().startsWith('file://'),
  originalFilename: z.string(),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LocalDocumentFile = z.infer<typeof localFileSchema>;
export const documentNative = {
  available: () =>
    Platform.OS === 'android' && !!NativePlatform?.documentCommand,
  async command<T>(
    owner: string,
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (!owner || !this.available())
      throw new Error(
        'Document capture is not available in this native build.',
      );
    const raw = await NativePlatform!.documentCommand(
      command,
      JSON.stringify({
        ...args,
        owner,
        maxBytes: DOCUMENT_FILE_LIMITS.singleBytes,
        maxCount: DOCUMENT_FILE_LIMITS.attachments,
      }),
    );
    return JSON.parse(raw) as T;
  },
  async pick(owner: string, mode: 'camera' | 'photos' | 'files') {
    return z
      .array(localFileSchema)
      .parse(await this.command(owner, 'pick', { mode }));
  },
  async operation() {
    if (!NativePlatform)
      throw new Error('Native document support unavailable.');
    return NativePlatform.createOperationId();
  },
};
export function documentMessage(error: unknown): string {
  const code =
    (error as { code?: string; message?: string })?.code ??
    (error as Error)?.message;
  const messages: Record<string, string> = {
    DOCUMENT_STORAGE_NOT_CONFIGURED:
      'Private document storage is not configured. Files remain on this device; no cloud backup has occurred.',
    DOCUMENT_EMAIL_NOT_CONFIGURED: 'Document email delivery is not configured.',
    DOCUMENT_FILE_TOO_LARGE:
      'Each file must be no larger than ' +
      DOCUMENT_FILE_LIMITS.singleBytes / 1048576 +
      ' MB.',
    DOCUMENT_TOTAL_TOO_LARGE:
      'The combined files must be no larger than ' +
      DOCUMENT_FILE_LIMITS.totalBytes / 1048576 +
      ' MB.',
    DOCUMENT_PAGE_LIMIT:
      'A document supports up to ' +
      DOCUMENT_FILE_LIMITS.attachments +
      ' attachments.',
    DOCUMENT_TYPE_UNSUPPORTED:
      'Choose a PDF, JPEG or PNG. Export HEIC as JPEG first.',
    DOCUMENT_PICKER_DENIED:
      'Allow access in the camera app or choose an existing photo.',
    DOCUMENT_SHARE_UNCONFIRMED:
      'Delivery could not be confirmed. Check history before sending again.',
  };
  return (
    (code && messages[code]) ||
    'The document action could not finish. Your pending files remain on this device. Retry when connected.'
  );
}
