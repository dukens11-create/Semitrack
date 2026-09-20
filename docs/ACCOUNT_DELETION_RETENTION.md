# Account deletion, retention and offline-access contract

Status: local implementation, not deployed. This is an engineering contract implementing the owner's instructions, not legal advice or a published privacy policy.

## Authenticated deletion

Settings > Account & profile > Delete account requires the current password, the exact phrase `DELETE MY ACCOUNT`, and a destructive confirmation. DELETE /me uses the existing revocable access-session middleware and ignores no ownership input: the strict body rejects extra fields. The authenticated principal is the only target. Active staff/admin and fleet owner/billing-admin accounts require ownership review first.

Within one PostgreSQL transaction, lock the principal, record an independent deletion tombstone, anonymize profile data, disable authentication, revoke every refresh/device-backed access session, consume unused reset tokens, remove pending ELD OAuth states and stored ELD credentials, and remove navigation preferences/favorites. Remove only unattached GENERAL document records with no stored file. Preserve all compliance/truck/file document records for review.

User rows are not hard-deleted. Database triggers stop restored/late writes from reactivating a tombstoned principal, reject new personal preferences/favorites/documents/OAuth states, and strip late ELD credentials. Writes lock the same owner row. Concurrent already-authenticated deletion operations are idempotent; new requests with a revoked token correctly return 401, rather than reviving authentication to replay a receipt. Any transaction failure rolls back all changes. A lost HTTP response must not be presented as confirmed deletion.

## Retained records

| Data | Handling |
|---|---|
| Profile name/email/phone/password | Anonymous deterministic email, Deleted account name, null phone, unusable password, disabled access |
| Session/reset credentials | Revoke/consume; retain security rows |
| ELD OAuth/credentials | Remove OAuth state; null stored credentials, scopes and personal metadata; disconnect locally |
| Preferences/favorites | Remove |
| Personal unattached GENERAL document record without a file | Remove |
| Compliance, truck-associated documents, actual stored file references | Retention hold |
| Truck/trip/equipment/fleet records | Preserve; no company records or ownership deleted |
| Payment/subscription/transaction/refund/dispute records | Preserve; no external billing cancellation or billing change |
| Community/safety reports | Preserve report and integrity evidence; author resolves to anonymized disabled principal |
| Security/audit records | Preserve for policy review; no rewrite of historical evidence |
| Backups | Never edit immutable backups; replay separately preserved deletion ledger before restored data can serve traffic |

`AccountRetentionPolicy` has six categories with NULL duration/approval fields. This is POLICY_REQUIRED, not an implicit forever-retention policy or an invented legal duration. A duration requires a nonnegative value, explicit approval reference and approval date together. There is no automatic purge job. Identifier-bearing retained/free-text/provider records require approved minimization rules before further erasure.

No push/device notification token registration subsystem exists in this source; there are no such token rows to revoke. All implemented authentication access is refresh-session-backed and revoked. Provider-side ELD token revocation cannot be claimed from removal of local credentials; approved provider capability and real acceptance remain external gates.

## Backup recovery gate (BLOCKED for operational acceptance)

The database tombstone table has no User foreign key. Operator-only `reapplyDeletionLedger` accepts strictly validated user IDs and deletion timestamps, replays idempotently, rejects future timestamps, and re-applies personal minimization/revocation. It has no public HTTP endpoint.

Before any restored database is exposed:
1. Keep API/workers unavailable to users.
2. Migrate the restored database to the compatible schema.
3. Obtain a complete, separately preserved, access-controlled latest deletion ledger, including deletions after the backup cutoff.
4. Invoke `reapplyDeletionLedger` in the trusted recovery process; verify disabled/anonymized users, revoked credentials and absence of eligible personal records.
5. Reconcile external provider and retained-record policies; then authorize reopening.

If the independent ledger is absent, stale, incomplete or untrusted, recovery must remain blocked. An old backup's own ledger is insufficient. This pass tests replay against synthetic restored records on PG16; it does NOT establish independent production ledger replication, backup completeness or production recovery acceptance. Those remain explicit deployment blockers. Ordinary updates cannot restore a tombstoned profile, but restoring an entire old database without the latest independent ledger cannot be made safe by triggers alone.

## Offline account continuity

This is a read-only preference view, never offline authentication or entitlement. After a validated online /me/login response, a separate device-unlocked, device-only Keychain record binds a snapshot to the current session. Only distance, temperature and appearance settings from acknowledged server responses are cached. It contains no account name/email, route, location, document, truck verification, subscription or navigation permission.

A real transport outage may offer the view; HTTP authorization/server/invalid-response errors do not. Users must explicitly enter it. No editable offline changes are queued, so server state remains authoritative and there is no merge/conflict policy to guess. The view expires at 24 hours from the last validated online account check; preference saves cannot extend that deadline. Missing/rotated session binding, malformed data, future timestamps, locked storage and expiration fail closed. Sign-out/account changes clear it. Foreground and expiry callbacks revalidate it. Device date rollback before verification fails closed; a compromised device clock/storage is not a trusted authorization mechanism and no authenticated action is enabled by the cache.

Real Android/iOS secure-vault restart/lock/backup behavior remains a device acceptance gate (F110/F003); local tests do not replace it.

## Rollout/rollback

New additive migration: 20260919020000_account_deletion_tombstones (12 total including prior uncommitted outbox migration). Previous 11 migrations are unchanged. Coordinate the new API with migration 12. Keep tombstones/triggers and retention records when rolling application code back. Do not drop the ledger or rollback erasure to recover old profile values. Review older API behavior against the new triggers before any rollback. No production migration ran in this pass.

## Personal data on the device

After a confirmed deletion receipt, the RN app also discards that owner's pending document-save record from protected storage and blocks late writes for the deleted owner. Other owners' document records are preserved. Local sessions/offline preferences are cleared even if document cleanup reports a vault failure; that failure is not treated as proof of complete device erasure. Exact-device secure-storage cleanup remains an acceptance gate. The non-sensitive, device-wide Day/Night appearance setting remains a device preference, not an account record or entitlement.
