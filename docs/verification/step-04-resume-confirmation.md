# Step 4 — Resume, End, and route cancellation

Status: Partially Fixed. Native Android acceptance remains blocked.

## Root cause and correction

Resume checked destination presence and heavy-duty profile type but did not require this handoff's successful route calculation. The handoff also ignored failed intermediate legs and held a mutable profile reference that could hide changes.

Resume now requires a confirmed owned destination and an unchanged reviewed profile snapshot, in addition to the existing map, foreground, GPS and truck safety gates. Failures for any stop belonging to this trip invalidate confirmation; a failure without a stop identity fails closed. Other identified trips are ignored. Closing the handoff clears its state. The UI explains how to recover from ENGINE_ROUTE_UNCONFIRMED without exposing native details.

Existing End behavior was inspected: it cancels pending Start ownership, suspends guidance, invalidates review, removes stops and polls removal for up to 15 seconds. Unconfirmed removal remains an error requiring retry. No SDK methods or truck specifications were changed.

## Exact files changed

- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotTripHandoff.java
- apps/mobile-react-native/src/services/copilot/HybridControls.ts
- apps/mobile-react-native/src/services/copilot/HybridControlDiagnostics.ts
- apps/mobile-react-native/scripts/test-hybrid-handoff.cjs
- apps/mobile-react-native/__tests__/hybrid-control-diagnostics.test.ts
- docs/verification/step-04-resume-confirmation.md

## Verification

- Java handoff contract harness: passed, including uncalculated resume, successful confirmation, changed dimensions, unrelated failure, intermediate-leg failure, null failure, cancellation and late callbacks after stopping. Harness compiles production helper classes against deterministic SDK doubles.
- Mobile Jest: 72 suites, 993 tests passed. Existing React act warnings remain.
- TypeScript typecheck: passed.
- Full Android SDK build and physical Android verification: not run. Private licensed SDK artifacts and a connected physical device are unavailable here.

The snapshot follows the existing fleet-profile and standard-truck implementation's toString readback convention. Completeness/stability of that representation still requires verification against the installed SDK. It is additional conservative checking, not a replacement for existing truck readback gates.

## Required device checks

On a licensed device with the actual truck profile, verify Start → Pause → Resume, background/foreground Resume, End during geocoding/calculation, delayed stop removal and End retry, intermediate-stop routing failure, and profile change while paused. Confirm canceled guidance is silent and no old session resumes. After process recreation, an unconfirmed route must require review and recalculation.

No maps, app data, licenses, production configuration or billing were changed. No deployment was performed.

Branch: codex/step-04-resume-confirmation, targeting fix/392-standard-truck-navigation.
Next step: Step 5 — GPS and live vehicle tracking. Step 4 device acceptance remains explicitly blocked.
