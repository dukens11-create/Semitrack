# Step 20 — ELD/fleet token revocation

Status: Partially Fixed; provider acceptance remains blocked.

Root cause: Samsara token revocation used fetch's default redirect behavior while token exchange and data requests already rejected redirects. A 307/308 response could forward the refresh-token request body to another target.

Correction: revokeProviderToken now uses redirect:error. Existing timeout, error sanitization and unsupported-provider behavior remain intact.

Files changed:
- apps/api/src/services/eldService.ts
- apps/api/test/eldRevocation.test.ts
- docs/verification/step-20-eld-revocation.md

Tests: TypeScript build passed; 7 focused ELD tests passed. The redirect regression uses a local HTTP server returning 307 and proves the destination receives zero requests. Additional tests cover sanitized provider failures and no request for unsupported revocation. Existing concurrency and normalization tests passed. All tokens in tests are synthetic fixtures; no provider account was contacted.

Android/provider verification: pending. Existing adapters are named SAMSARA and MOTIVE, but approved provider selection, OAuth credentials/scopes, production entitlements and provider sandbox records were not verified. Account-level HOS snapshots do not establish signed-in driver identity: currentHosStatus intentionally reports DRIVER_MAPPING_REQUIRED or ELD_DATA_STALE and certifiedEld:false. Do not enable a driver HOS claim until driver/vehicle association and provider authorization are proven. No certified ELD compliance is claimed.

Branch: codex/step-20-eld-revocation; stacked on codex/step-19-billing-test-key-guard.
Next: Step 21 — separate driver web application. Step 22 remains blocked by native device tests and provider integrations. No APK build, deployment or production configuration change.
