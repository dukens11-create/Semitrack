# Step 5 — GPS and live vehicle tracking

Status: Partially Fixed. Physical Android verification pending.

Root cause: LocationService.requestFreshFix restarted stale or failed tracking with background=false. startIfPermitted did the same after an error. Native SemiTraxPlatformModule stops foreground-only tracking in onHostPause, so this recovery could silently downgrade an explicitly requested background session.

Correction: retain the requested tracking mode across acquisition and foreground-resume recovery. Explicit stop resets that intent. Existing native permission checks, service startup restrictions, mock-location rejection, freshness/accuracy limits and impossible-jump filtering remain in force. This does not grant background permission or promise tracking after process termination.

Files changed:
- apps/mobile-react-native/src/services/location/LocationService.ts
- apps/mobile-react-native/__tests__/gps-route-acquisition.test.ts
- docs/verification/step-05-gps-recovery.md

Tests: all 72 mobile suites / 996 tests passed; TypeScript typecheck passed. Three added cases cover stale fix, provider error and app resume, including resetting mode after explicit stop.

Android verification: pending. Test on the licensed device: precise permission granted/denied/revoked; start background tracking from foreground; lose and recover GPS; request a fresh route origin then lock screen; verify continued coordinates and camera follow; return to foreground; explicitly stop; confirm tracking stops. Verify speed, heading, CoPilot map matching and real movement independently. Unit tests do not establish native service behavior or CoPilot rendering.

Commit/PR: branch codex/step-05-gps-recovery targets fix/392-standard-truck-navigation.
Remaining blockers: connected physical Android device and runtime evidence for screen-lock, GPS loss, native permissions and camera/map matching.
Next step: Step 6 — Voice navigation and speaker output.

Deployment context: PR #407 merged as d9f7da0fdc5466c0b7ded897fd5f14467cf9632f; its push triggered APK workflow run 42417042802. The workflow restores persistent signing identity and verifies com.semitrax.app.hybridtest392. An APK artifact is not a phone installation or a production-store rollout. Preserve existing app data and installed maps; never uninstall to bypass a certificate mismatch.
