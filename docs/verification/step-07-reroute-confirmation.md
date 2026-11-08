# Step 7 — Rerouting and missed turns

Status: Partially Fixed.

Root cause: CoPilotGuidanceTelemetry unconditionally treated onCompleteRouteCalculation as ready. A completion after failure, arrival or reset could re-enable presentation of route ETA and instructions.

Correction: a calculation-state guard accepts completion only from calculating. Failure stays failed until a new calculation starts. Cancellation, arrival and reset cannot be revived by an isolated completion. This is a presentation correction; it neither initiates rerouting nor changes any truck restriction.

Files changed:
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotCalculationState.java
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotGuidanceTelemetry.java
- apps/mobile-react-native/scripts/test-hybrid-handoff.cjs
- docs/verification/step-07-reroute-confirmation.md

Tests: Java production state helper and existing handoff/profile contract harness passed. Guidance presentation: 14 tests passed. No APK build requested.

Android verification: pending. Actual deviation detection and recalculation remain SDK-owned. Existing standardProfileMonitor checks accepted truck configuration every second and suspends guidance on mismatch. That polling does not prove restrictions are applied atomically to every SDK recalculation. Full acceptance requires the licensed SDK/device, representative missed turns, changed restrictions while calculating, offline coverage and loss/recovery testing. Unidentified native callbacks cannot be assigned to a specific calculation with invented IDs; stale completion from an old calculation during a newer calculating state remains a device/SDK-contract verification item.

Branch: codex/step-07-reroute-confirmation, stacked on codex/step-06-voice-readback.
Next: Step 8 — Satellite mode.
