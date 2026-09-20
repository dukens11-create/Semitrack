/**
 * Legacy storage entry point retained only to prevent accidental imports from
 * silently re-enabling the old public-S3 document path.
 *
 * The supported document API is metadata-only until a private, authenticated,
 * retention-reviewed storage lifecycle is implemented and accepted.
 */
export async function uploadDocument(
  _fileName: string,
  _mimeType: string,
  _buffer: Buffer,
): Promise<never> {
  throw new Error("DOCUMENT_STORAGE_UNAVAILABLE");
}
