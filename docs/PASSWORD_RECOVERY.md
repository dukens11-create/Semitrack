# Password recovery deployment gate

Provider approved: Resend. Reset-link host approved: `https://www.semitrax.com`.
This source integration has not sent a production email or changed Render settings.

Set server environment variables in Render, not mobile configuration:

- `RESEND_API_KEY`: restricted sending key from Resend; store as a secret.
- `PASSWORD_RESET_FROM_EMAIL`: mailbox on the sender domain verified in Resend. No sender address is assumed by code.
- `PASSWORD_RESET_BASE_URL`: deployed HTTPS reset-page URL on `www.semitrax.com`, without credentials, query or fragment. Example proposed page: `https://www.semitrax.com/reset-password.html`. This example does not establish that a page is deployed.

Production startup rejects missing recovery configuration. Development without configuration returns `503 RECOVERY_UNAVAILABLE` for every recovery request. Do not deploy this API revision until the settings and reset page are ready. The existing Render Blueprint does not automatically populate these new values; add them to the service environment before a separately authorized deployment.

The website reset page is a remaining deployment dependency. It must read the `token` from the URL **fragment**, clear it from browser history immediately, hold it only in memory, and POST `{token,password}` to the approved API's `/auth/password-reset/confirm` over HTTPS. It must not put tokens in analytics, URLs, local storage or logs, and should send `Referrer-Policy: no-referrer` with a restrictive CSP. Do not add third-party scripts to this page. The API CORS allowlist must include exactly `https://www.semitrax.com`.

The API sends a one-hour, one-use opaque token; only its SHA-256 hash is stored. A request does not invalidate a working login or an earlier reset email. Delivery failure invalidates only the newly created token and emits the fixed `RECOVERY_DELIVERY_FAILED` event, without email address, credential, token or provider response. Successful reset consumes outstanding reset tokens and revokes refresh/access sessions. The HTTP response is returned before account lookup and provider work, with a bounded queue (20 outstanding jobs, 4 workers). Admission overload returns the same 503 regardless of account. Unknown and disabled accounts receive the same accepted response as enabled accounts; provider rejection is not disclosed to callers. Jobs are currently in memory and can be lost on restart; a durable encrypted outbox with retry/alerting remains a release-readiness dependency. Do not report 202 as delivered email.

Resend HTTP acceptance does not prove inbox delivery. Before releasing, separately verify the sender DNS, deliver to a controlled account, open the actual HTTPS page, reset once, reject reuse/expiry and verify revoked sessions. Do not reset a real driver's account for diagnostics.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
