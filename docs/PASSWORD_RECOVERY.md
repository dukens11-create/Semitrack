# Password recovery deployment gate

Provider approved: Resend. Reset-link host approved: `https://www.semitrax.com`.
This source integration has not sent a production email or changed Render settings.

Set server environment variables in Render, not mobile configuration:

- `RESEND_API_KEY`: restricted sending key from Resend; store as a secret.
- `PASSWORD_RESET_FROM_EMAIL`: mailbox on the sender domain verified in Resend. No sender address is assumed by code.
- `PASSWORD_RESET_BASE_URL`: deployed HTTPS reset-page URL on `www.semitrax.com`, without credentials, query or fragment. Example proposed page: `https://www.semitrax.com/reset-password.html`. This example does not establish that a page is deployed.

Production startup rejects missing recovery configuration. Development without configuration returns `503 RECOVERY_UNAVAILABLE` for every recovery request. Do not deploy this API revision until the settings and reset page are ready. The existing Render Blueprint does not automatically populate these new values; add them to the service environment before a separately authorized deployment.

The website reset page is a remaining deployment dependency. It must read the `token` from the URL **fragment**, clear it from browser history immediately, hold it only in memory, and POST `{token,password}` to the approved API's `/auth/password-reset/confirm` over HTTPS. It must not put tokens in analytics, URLs, local storage or logs, and should send `Referrer-Policy: no-referrer` with a restrictive CSP. Do not add third-party scripts to this page. The API CORS allowlist must include exactly `https://www.semitrax.com`.

The API sends a one-hour, one-use opaque token. The reset-token table stores only its SHA-256 hash. A request does not invalidate a working login or an earlier reset email. Successful reset consumes outstanding reset tokens and revokes refresh/access sessions. Admission precedes account lookup and provider work; unknown and disabled accounts receive the same accepted response as enabled accounts. Overload returns the same 503 regardless of account. Errors emit only the fixed `RECOVERY_DELIVERY_FAILED` event. Do not report 202 as delivered email.

## Required production outbox — local implementation, not production activation

`20260919010000_core_recovery_outbox` adds only the `RecoveryDeliveryJob` table and an admission index. The previous ten migrations are unchanged. An authorized deployment must apply this migration **before** configuring `PASSWORD_RECOVERY_OUTBOX_KEY`: a dedicated secret consisting of 32 random bytes encoded as 64 hex characters. Do not reuse a JWT, API, or signing key. No key is generated or configured by this change.

With the key and existing recovery-email configuration present, the API stores the recipient and opaque token encrypted with AES-256-GCM, a random nonce, and the job ID as authenticated associated data. It performs bounded admission (20 outstanding jobs across instances), a two-minute worker lease, and at most three delivery attempts with 30/60-second delays. Retries reuse the same token and delivery idempotency key. Unknown/disabled accounts do not cause email. Expired/exhausted jobs are removed; completed jobs are deleted. Used reset tokens are not resent. Graceful shutdown drains admitted work before disconnecting the database. Abrupt process termination leaves a lease that another worker can reclaim after expiry.

The key must survive API restarts. Retain it until pending jobs expire or finish when planning rotation; replacing it immediately makes old jobs unreadable. Protect access to both key and database. Production alerting for the fixed failure event and delivery/inbox acceptance remain external release gates. PostgreSQL 16.15 local tests cover encrypted storage, retries, lease expiry, concurrent workers/admission, expiry, tampering, and cleanup; they do not prove production email delivery.

Production startup now rejects a missing or malformed outbox key. Only development/test may use the existing in-memory compatibility queue without the key (20 outstanding jobs, four workers). Its pending work can still be lost on abrupt restart; delivery failure invalidates only its newly created token. **Durable recovery must not be reported operational while this fallback is active.** An old API can run with the additive table present, but it cannot drain outbox jobs. Coordinate rollback/draining explicitly; do not drop the table or discard pending jobs automatically.

## Mobile reset entry

The RN panel now parses the email service's fragment token as well as existing query links; ambiguous duplicate tokens are rejected. Signed-out automatic entry accepts only HTTPS on `www.semitrax.com`, paths `/reset-password` and `/reset-password.html`, without embedded credentials. It holds tokens in memory and never submits automatically. Other paths remain available through the explicit paste-link flow.

Android manifest wiring is present, but domain `assetlinks.json`, the actual release certificate association, the deployed reset-page path and cold/warm device acceptance still need verification. iOS AppDelegate now forwards URL and user-activity callbacks to the existing validated React Native Linking handler. The associated-domain entitlement/site association, Mac compilation and device acceptance remain blocked. This change does not deploy a website, associate a domain, configure iOS signing, or claim working universal links.

Resend HTTP acceptance does not prove inbox delivery. Before releasing, separately verify the sender DNS, deliver to a controlled account, open the actual HTTPS page, reset once, reject reuse/expiry and verify revoked sessions. Do not reset a real driver's account for diagnostics.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
