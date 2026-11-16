# Search timeout recovery — November 16, 2026

Phone screenshots show a sign-in REQUEST_TIMEOUT, a place-search timeout, and the
same five standard-truck validation messages. They do not prove a common cause.
Address search talks directly to Mapbox; authentication and saved trucks use the
SemiTraX API. No password or authenticated account request was used in this check.

Current public checks: /health returned HTTP 200 with database ok in about 4.6–5.2
seconds. An empty, validation-only /auth/login request returned HTTP 400 in about
4.4 seconds. This establishes current endpoint responsiveness, not successful login
or the cause of the earlier phone timeouts. Hosting logs remain uninspected because
the Render workspace has not been confirmed.

A reproducible search defect was found: the 15-second deadline only aborted fetch.
If the transport or response body ignored abort, the caller could remain pending.
The request now races transport and JSON body parsing against a rejecting deadline;
caller cancellation also settles immediately, and timers/listeners are cleaned up.
Existing safe error classification and no-automatic-retry behavior are preserved.
Late responses cannot replace the timeout result. No addresses, credentials or
provider error bodies are logged.

Regression cases cover abort-ignoring transport, stalled response JSON, cancellation,
late completion, safe errors and timer cleanup. This does not alter account sessions,
truck measurements, avoidance preferences, routing gates, licensing or map storage.
It is not a fix for provider availability or the missing native truck-profile transfer.
