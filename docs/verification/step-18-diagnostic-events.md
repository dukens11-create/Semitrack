# Step 18 — Recovery and diagnostics
Status: Partially Fixed.
Root cause: native standard-truck monitoring emits PROFILE_CHANGED_GUIDANCE_PAUSED and STANDARD_PROFILE_MATCH, but the diagnostic sanitizer discarded both known stages as NOT_AVAILABLE.
Correction: allow only those two fixed event codes through the existing schema. Raw truck profiles, locations, unknown strings and credentials remain excluded.
Files changed:
- apps/mobile-react-native/src/services/copilot/CoPilotDiagnosticReport.ts
- apps/mobile-react-native/__tests__/hybrid-diagnostics.test.ts
- docs/verification/step-18-diagnostic-events.md
Tests: 7 diagnostic-export tests passed; TypeScript passed after generating local configuration. Added regression cases verify both safe stages survive while extra profile/location fields do not.
Android verification: pending. Existing bounded lifecycle reads and Start ownership repairs do not prove crash recovery after process termination. Physical background/foreground, forced termination, renderer stalls and listener cleanup still require evidence.
Branch: codex/step-18-diagnostic-events, stacked on codex/step-17-api-dependencies.
Next: continue mobile security remediation; Step 19 billing audit.
No APK build or production configuration changes.
