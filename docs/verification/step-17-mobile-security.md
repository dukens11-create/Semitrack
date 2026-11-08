# Step 17 — Mobile dependency security follow-up

Status: Partially Fixed; residual audit findings remain a release blocker.

Root cause: the mobile lockfile retained vulnerable transitive versions and Zod 3. Upgraded compatible lockfile resolutions and Zod to 4.6.7. Migrated record schemas to explicit string keys. Zod 4 requires unknown fields unless marked optional; diagnostic metadata now explicitly retains the prior missing-value fallback, without admitting arbitrary exported strings.

Files changed:
- apps/mobile-react-native/package.json
- apps/mobile-react-native/package-lock.json
- apps/mobile-react-native/src/features/poi/PoiService.ts
- apps/mobile-react-native/src/features/settings/SettingsService.ts
- apps/mobile-react-native/src/services/copilot/CoPilotDiagnosticReport.ts
- apps/mobile-react-native/__tests__/hybrid-diagnostics.test.ts
- docs/verification/step-17-mobile-security.md

Verification on 2026-11-08: clean npm ci with scripts disabled; TypeScript passed; all 75 suites / 1,019 tests passed before adding the explicit missing-metadata regression. The focused diagnostic suite including that regression has 8 tests. npm audit now reports 22 findings: 0 critical, 0 high, 14 moderate, 8 low (previously 32: 1 critical, 8 high, 15 moderate, 8 low). Remaining advisory roots include deepmerge, minimatch and fast-xml-parser, with transitive toolchain findings. No forced CLI/Jest downgrades or unverified major overrides applied. Residual risk has not been approved or declared resolved.

React Native remains 0.85.0; @rnmapbox/maps remains 10.3.5; the vendor/copilot lock entry is unchanged. No SDK substitution, APK build, installed app changes, map removal, credential changes or production deployment.

Android verification: pending; licensed SDK compilation and physical-device behavior were not verified by these JavaScript tests.

Branch: codex/step-17-mobile-dependencies, stacked on codex/step-18-diagnostic-events. Next: Step 19 billing, with native/provider acceptance blockers retained.
