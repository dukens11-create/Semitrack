# Driver document attachments — implementation and activation gates

## Architecture

The existing Documents records, categories, dates, labels, ownership and revision checks are preserved. Attachments use private object storage; PostgreSQL stores metadata, status, checksum, order and sharing/audit records only. Android captures and previews real files in app-private storage. No file is declared cloud-saved until the backend has verified the upload.

Central limits are in `apps/api/src/contracts/documentFiles.ts`, re-exported by React Native: 15 MiB per file, 50 MiB per document, 20 attachments. PDF page counts are not inferred. Supported formats are PDF, JPEG and PNG; unsupported HEIC must be exported as JPEG. File extension, MIME, magic bytes, byte count and SHA-256 are validated. These checks are not malware scanning.

## Database

Migration `20260920010000_document_attachments` is migration 14. It adds DocumentAttachment, DocumentShare and DocumentObjectCleanup, plus Document.deletedAt. Earlier migrations are preserved. Apply it through an approved future backend deployment; this task applied migrations only to an isolated local PostgreSQL 16.15 test cluster.

## Private storage configuration — not activated by this task

The existing API process reads these names, never the mobile app:

- DOCUMENT_STORAGE_PROVIDER=s3
- DOCUMENT_STORAGE_PRIVATE_CONFIRMED=true
- DOCUMENT_S3_BUCKET
- DOCUMENT_S3_REGION
- AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY; optional AWS_SESSION_TOKEN

Before enabling, configure and independently verify S3 Block Public Access, private bucket/object policy, restricted IAM access to the documents prefix, TLS, encryption, region and retention requirements. The confirmation flag is an operator assertion, not a remote bucket-policy audit. No bucket or IAM changes were made here.

The adapter signs bounded S3 operations and requests AES256 server-side encryption. Mobile clients never receive an upload credential or choose an object key. Upload retries use conditional creation; an existing object must match checksum and size. The API authorizes every download and returns a 15-minute signed link. Signed links are bearer credentials: recipients can forward them, and retained objects may remain accessible through an already issued link until it expires. Do not log signed URLs.

Without configuration, the API returns DOCUMENT_STORAGE_NOT_CONFIGURED. Test storage adapters are limited to tests and are not evidence of cloud acceptance.

Official implementation references: [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [SigV4 query authentication](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html).

## Upload, offline and cleanup

Android system camera/document pickers grant scoped access; no broad media/storage permission was introduced. Captured images are oriented and bounded to 4,000 pixels on the longest edge with JPEG quality 92; device readability acceptance remains required. Private files and an owner-scoped Keychain queue survive normal restarts. This supports capture while an authenticated session is available offline; it does not claim full offline account-login continuity.

Queue states: PENDING, UPLOADING, COMPLETE, FAILED. Actual transport progress is shown; manual retries back off from 1 second to 5 minutes, retain operation identities and skip completed bytes. No automatic retry network loop was added. Editing the draft supports multiple images, removal and ordering before upload. Pending drafts can be retried or discarded with confirmation.

The server records durable cleanup before external upload I/O. Incomplete/orphan objects have a technical one-day cleanup deadline, not an invented legal retention period. A single-flight worker checks up to 10 due jobs each minute when storage is configured. Failed removal remains queued. Cleanup rechecks deadline, saved state and retention holds under a document lock before removing bytes. Replacements become current only after the new upload is verified.

Deletion is a confirmed tombstone plus cleanup. Fleet-linked files are held for retention review (POLICY_REQUIRED), including replaced files. No fleet legal duration was invented. Existing conservative account-deletion retention applies to attached records; confirmed deletion clears pending local files/queue. Immutable backup destruction was not introduced.

## Sharing

Native Android ACTION_SEND/ACTION_SEND_MULTIPLE uses a non-exported FileProvider, scoped temporary read grants and original filenames. Only SHARE_SHEET_OPENED is recorded; the app cannot claim recipient delivery.

Email reuses existing Resend credentials and sender configuration. Activation additionally requires DOCUMENT_EMAIL_ENABLED=true; DOCUMENT_EMAIL_FROM optionally overrides the existing PASSWORD_RESET_FROM_EMAIL. The adapter sends expiring links with an idempotency key. Provider acceptance records SENT_TO_PROVIDER, never DELIVERED. A failed or ambiguous send remains failed/unconfirmed and is not automatically re-sent. No actual email was sent in this task.

Malware scanning remains NOT_CONFIGURED. No file is described as scan-clean. Secure scan/quarantine policy and delivery webhooks require a separate approved acceptance pass.

## APIs

All existing document routes remain authenticated. New routes under `/documents`:

- GET /capabilities; GET /:id
- POST /:id/upload-init
- PUT /:id/attachments/:attachmentId/bytes (bounded octet stream)
- POST /:id/upload-complete
- GET /:id/download?attachmentId=...
- POST /:id/attachment-order
- DELETE /:id; DELETE /:id/attachments/:attachmentId
- POST /:id/share

Every object operation enforces the authenticated owner server-side. Cross-user access is rejected; storage keys and credentials are not returned in document detail. Audit events record action/record identifiers without file bodies or signed URLs.

## Platform limitations and device checklist

Android native bridge compilation, React Native codegen/wiring, tests and production JavaScript bundling passed locally. A complete APK was not built, signed or installed. iOS has the same command boundary but explicitly reports native file support unavailable; camera/picker/share adapter and Mac/iPhone acceptance remain pending.

Before release on Samsung, verify:

1. BOL/POD/Rate Confirmation/custom labels and date flows; Day/Night and large text.
2. Camera capture/cancel/retake, rotated text readability, denied access and no camera app.
3. Multiple photos and PDF picker, HEIC rejection, large files, 20 attachments and total-byte limit.
4. Offline capture, force-stop/relaunch, reconnect/manual retry, actual upload progress and no duplicate saved upload.
5. Authorized configured private store upload/open; another account cannot list/download/share it.
6. Replace without losing label/type/dates; page reordering; confirmed delete and eventual cleanup/retention holds.
7. Native one/multiple-file sharing into installed apps; expiring email links, accepted versus delivered status and send history.
8. Account switch/sign-out isolation, account-deletion local cleanup and interrupted upload recovery.

No routing behavior, truck restrictions, CoPilot licensing or vendor binary change is part of document management.
