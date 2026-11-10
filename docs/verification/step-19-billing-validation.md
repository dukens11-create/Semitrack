# Step 19 — Billing configuration and trial consistency

Status: Partially Fixed. Store purchase integration remains blocked.

Root causes:
- Test-mode validation rejected sk_live_ but accepted rk_live_, permitting a restricted live credential in a test configuration.
- The example environment specified seven days, but the default configuration, catalog summaries and admin explanation still advertised fourteen days.

Corrections: reject both live server-key prefixes without echoing credentials; accept both test-key prefixes. Align the default trial, catalog and admin copy with the requested seven days, including dynamic price summaries. Preserve explicit environment overrides, product identifiers, prices and existing subscription contracts. No production configuration or provider products changed.

Files changed:
- apps/api/src/config/billingConfig.ts
- apps/api/src/contracts/subscriptionPricing.ts
- apps/api/test/billingConfiguration.test.ts
- apps/api/test/approvedOffers.test.ts
- apps/api/test/subscriptionOffers.integration.test.ts
- apps/admin/src/SubscriptionAdmin.tsx
- docs/verification/step-19-billing-validation.md

Source: https://docs.stripe.com/keys/restricted-api-keys confirms rk_live_ and rk_test_ prefixes. Test inputs are explicitly synthetic fixtures; no provider credentials were read or committed.

Tests: TypeScript build passed; 327 API tests passed, zero failed, 43 database-dependent tests skipped. Regression cases cover live/restricted-live rejection, whitespace, no secret disclosure, both test prefixes, and static/dynamic trial summaries. Database integration tests require a test database. No real payment or sandbox purchase was performed.

Android verification: pending. The mobile SubscriptionService explicitly reports purchase/restore unavailable, and catalog endpoints return purchaseAvailable:false. No native store purchase/receipt bridge is configured. Play/Apple product terms, verified receipts, seven-day offer eligibility and purchase/restore/expiry flows require provider setup and official sandbox verification. The server's entitlement foundation is not evidence of a complete store integration.

Branch: codex/step-19-billing-test-key-guard; base fix/392-standard-truck-navigation.
Next: Step 20 — ELD/fleet integration audit and safe provider failure handling.
