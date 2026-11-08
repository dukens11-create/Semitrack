# Step 17 — Security dependency correction
Status: Partially Fixed. API audit is clear; mobile audit is not.

API audit on November 7, 2026 found qs (moderate), zod (high), and esbuild (low development-tool finding). Updated Zod 3.25.76 to 4.6.7; constrained qs to 6.16.1 and esbuild to 0.28.1 through overrides. Adapted record schemas to explicit string keys and retained parsed DOT mapping defaults with prefault.

Validation: API build and 322 tests passed; 43 database tests skipped (no test database). Post-update npm audit, all dependency types: zero findings. Existing DOT default-mapping tests exercise the Zod migration. Overrides are retained because audit fix alone left qs/esbuild findings.

Mobile audit: 32 findings (1 critical, 8 high, 15 moderate, 8 low), including shell-quote and Zod. Not fixed by this API change; mobile release remains blocked on compatible updates and regression validation. A package audit is not a complete security review or secret scan.

Exact changed files:
- apps/api/package.json
- apps/api/package-lock.json
- apps/api/src/server.ts
- apps/api/src/modules/admin/operational.routes.ts
- apps/api/src/modules/safety/safety.routes.ts
- apps/api/src/services/providers/dot511Provider.ts
- docs/verification/step-15-weather.md
- docs/verification/step-16-authentication.md
- docs/verification/step-17-api-security.md

References:
https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
https://github.com/advisories/GHSA-6pq8-jhm2-2vcw
https://github.com/advisories/GHSA-g7r4-m6w7-qqqr

Android: pending; this branch changes API validation/dependencies, not SDK restrictions. No deployment, billing or production configuration changes.
Branch: codex/step-17-api-dependencies, stacked on codex/step-14-station-expiry.
Next: finish mobile security remediation, then Step 18 diagnostics.
