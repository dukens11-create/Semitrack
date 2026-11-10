# Step 3 — Start Navigation

Status: Partially fixed; licensed Android build and real route acceptance pending.

Root cause: CoPilotHostModule started its 60-second confirmation timer only after synchronous native geocoding returned on the worker thread. A stalled lookup left Start pending indefinitely. Simply rejecting a timeout would also allow a late worker response to submit stops unless its attempt ownership was invalidated.

Correction: CoPilotStartAttempt starts a 60-second deadline before the worker launches. Success, failure, End Route and module invalidation retire the attempt and cancel its deadline. Late worker results and poll callbacks must still own the active attempt before acting. A timed-out but still-running native lookup blocks another geocoding worker and reports ENGINE_GEOCODE_BUSY instead of accumulating threads. No unsupported SDK cancellation API is invented; a permanently stalled native call still requires device-level diagnosis.

Existing license, map, foreground GPS, truck readback, profile confirmation and stop validation gates remain. Submission still does not count as success: existing route-calculation callbacks must confirm it. No car routing fallback, changed truck dimensions, deleted maps, billing changes or release actions.

Files:
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotStartAttempt.java
- apps/mobile-react-native/scripts/test-start-attempt.cjs
- apps/mobile-react-native/package.json
- apps/mobile-react-native/src/services/copilot/HybridControlDiagnostics.ts
- apps/mobile-react-native/src/services/copilot/HybridControls.ts
- apps/mobile-react-native/__tests__/hybrid-control-diagnostics.test.ts
- docs/verification/step-03-start-navigation.md

Verification:
- Production Java attempt class compiles on Java 17. Deterministic scheduler tests pass for timeout, duplicate start, late completion, stale timer, success and cancellation. Added to npm run check.
- Existing Java hybrid handoff tests pass, using SDK doubles; this is not real SDK evidence.
- TypeScript passed. Full mobile suite: 72 suites, 991 tests passed before the final busy-message regression. Final focused diagnostics tests and Java deadline tests pass.
- Full Android bridge compilation is not verified: the licensed CPIK package is absent. Physical Android Start is not verified.

Device acceptance: test successful commercial routing; delayed/failed destination lookup; repeated taps; End Route while resolving; backgrounding; deadline expiry and a late result. Confirm only the current attempt can start guidance. Preserve package identity, signing certificate, licenses and installed maps. Run after Step 1 readback/authentication prerequisites pass.

Next: Step 4 — Resume, End and route cancellation, especially cancellation while native stop submission remains pending.

Rollback: close the unmerged draft, or revert its commit after a separately approved deployment. No data migration. PRs 404 and 405 were separately approved and merged into fix/392-standard-truck-navigation; this change is a new draft.
