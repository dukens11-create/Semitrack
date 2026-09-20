/** Shared mobile/API limits. Binary contents never belong in a database record. */
export const DOCUMENT_FILE_LIMITS = {
  singleBytes: 15 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  attachments: 20,
  downloadSeconds: 900,
} as const;
export const DOCUMENT_MIME = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
} as const;
export type DocumentMime = keyof typeof DOCUMENT_MIME;
export type FileDescriptor = {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
};
export function validateDocumentFile(file: FileDescriptor) {
  if (
    !file.originalFilename ||
    file.originalFilename.length > 150 ||
    /[\\/\x00-\x1f\x7f]/.test(file.originalFilename)
  )
    throw new Error("DOCUMENT_FILENAME_INVALID");
  const extensions = DOCUMENT_MIME[file.mimeType as DocumentMime] as
    | readonly string[]
    | undefined;
  if (
    !extensions ||
    !extensions.includes(file.originalFilename.split(".").pop()!.toLowerCase())
  )
    throw new Error("DOCUMENT_TYPE_UNSUPPORTED");
  if (
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 1 ||
    file.sizeBytes > DOCUMENT_FILE_LIMITS.singleBytes
  )
    throw new Error("DOCUMENT_FILE_TOO_LARGE");
  if (!/^[a-f0-9]{64}$/.test(file.checksum))
    throw new Error("DOCUMENT_CHECKSUM_INVALID");
  return file;
}
export function validateDocumentFiles(files: FileDescriptor[]) {
  if (files.length > DOCUMENT_FILE_LIMITS.attachments)
    throw new Error("DOCUMENT_PAGE_LIMIT");
  files.forEach(validateDocumentFile);
  if (
    files.reduce((n, f) => n + f.sizeBytes, 0) > DOCUMENT_FILE_LIMITS.totalBytes
  )
    throw new Error("DOCUMENT_TOTAL_TOO_LARGE");
}
