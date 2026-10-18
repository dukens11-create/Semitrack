# Hybrid issue 392 repair

Target: `com.semitrax.app.recovery.hybrid`, versionCode **392**, versionName **0.1.392**.
Base: `codex/sept27-mapbox-engine` / b56071e. No Flutter/migration app changes.

## Actual execution path

`original_semitrax_copilot_apk.yml` → `apps/mobile-react-native/android :app:assembleDebug` →
`MainApplication` / `CoPilotHostPackage` → `PlanningScreen` → `HybridNavigation` →
`SemiTraxCoPilotHost` / `CoPilotTripHandoff`. The driving map is `EngineMapboxProof` using
Mapbox with CoPilot telemetry/geometry; no native CoPilot map is mounted in Hybrid controls.
The old Hybrid workflow is manual-only to avoid competing automatic artifacts.

Resume previously only set a React flag. Settings opened the SDK UI. End previously required
map readiness and assumed asynchronous stop deletion completed immediately. Weather had
no automatic refresh, depended on a planner route, and was hidden while driving.

## Changes

- Resume now invokes native resume; Start only opens live display after confirmation.
  Native trip submission waits for stop identity and route-calculation callbacks with a
  bounded timeout. End invalidates in-flight preparation, suspends guidance and verifies
  all stops disappeared before clearing JS route state. Late callbacks cannot restart a
  cancelled geocoding request. Failures retain state for retry.
- Branded TruckProfileScreen reuses authenticated persistence, revision verification,
  dimensions/axles/trailer/hazmat validation. Editing an active trip is blocked.
- No partial truck sync: both JS and native fail closed for the bundled SDK's unsupported
  required restrictions. A Save is not reported as engine synchronization.
- Weather uses authenticated POST `/weather/current`, fresh precise location, OpenWeather
  validation/correlation and provider timestamps. Loading, unavailable, stale and connection
  error states are explicit. Shown in controls and driving view, with no synthetic readings.
- Diagnostics include native build commit/time/package/variant/version and bounded control
  events. Events exclude coordinates, profile values, accounts, credentials and raw exceptions.
- CI restores the existing verified persistent test certificate, builds the exact Hybrid
  package, verifies the certificate/package and archives commit/checksum/certificate metadata.

## Vendor blocker — not a working-navigation claim

The bundled CPIK **10.28.2-497** `VehicleDimensions` supports length/width/height/total weight/
weight per axle. Its inspected `VehicleRoutingProfile` does not expose axle count or trailer
count/type. SemiTraX requires these, and its existing exhaustive mapping deliberately marks
those restrictions unsupported. Current loaded-weight policy, multi-class hazmat and strict
ferry/residential/dirt-road avoidance also need supported equivalents where requested.

Accordingly **Start and Resume remain safety-blocked** until Trimble supplies/authorizes a
compatible SDK and confirms the complete mapping and readback contract. No fabricated sync
receipt, passenger route fallback, loss of restrictions or hardcoded device identity is used.
The native `applyTruckProfile` explicitly rejects without changing the SDK profile. Completing
actual profile synchronization is an outstanding vendor-dependent item, not claimed fixed.

Official reference: https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/
Latest profile documentation describes newer-version features; it is not evidence they exist
in the pinned 10.28 JAR. An SDK upgrade must be separately validated for licensing and Android.
Trimble must also confirm full-navigation/heavy-duty/map entitlements for the existing assigned
device and permission/support for the headless engine + Mapbox display integration.

## Preservation and installation

No device enrollment, saved ID, licensing calls, map deletion, application-data wipe or regional
map selection was changed. This APK uses the same Hybrid applicationId. Earlier Hybrid builds
used a workflow without a restored signing key, so certificate continuity is **not established**.
Compare the installed base APK certificate with the new artifact before `adb install -r`.
If different, STOP: recover the original signing key; do not uninstall or clear app data.
A successful build does not prove an in-place update or on-device navigation.

## Weather deployment

The backend addition needs deployment to the intended `semitrax-api` service after code review.
`OPENWEATHER_API_KEY` remains server-only. Render connector has no selected workspace in this
session, so active deployment/key configuration and a real authenticated weather response could
not be verified. An unauthenticated probe of `/weather/current` returned HTTP 401, confirming reachability but not provider health. No production environment variables or deploys were changed.

## Physical acceptance still required

Use the recorded commit/certificate to identify the installed APK. On the Samsung API36 device,
verify the existing assignment and California inventory survive the update; press each control,
check diagnostics, background/foreground, stop during calculation, retry failed stop and test
weather online/offline. After the Trimble mapping blocker is resolved, validate actual truck
profile readback, licensed start/resume, geometry/turns/rerouting, and native stop on device.
Do not merge or claim truck guidance verified until these checks and CI pass.

## Validation record

Local full mobile check: 903 tests passed across 62 suites, TypeScript and lint passed,
native Android/iOS wiring check passed, 9 tooling tests passed, Java handoff contract test passed.
Two subsequent diagnostics privacy/identity tests also pass (18 focused tests total).
Backend: 320 passed, 43 skipped (database/infrastructure-gated), zero failed.
The first CI attempt caught a strict test indexing type error; corrected before the new run.

`install-hybrid.ps1` is included in the APK artifact. It checks the exact expected commit,
checksum, APK package/version and installed signing certificate before using `adb install -r`.
It never clears data, uninstalls, or copies private app data. PowerShell/physical-device execution
has not been performed in this environment.
