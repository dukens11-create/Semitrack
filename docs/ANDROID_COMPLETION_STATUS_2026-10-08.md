# Semitrax Android completion status — 8 October 2026

The Android app can be built and installed as a standalone ARM64 test APK. It is
not yet a verified truck navigation product. This status supersedes old build
failure statements in the September CPIK audit; it does not supersede its
unresolved licensing and truck-restriction findings.

## Repairs in this change

- A failed Mapbox map can be retried in place or when returning to the foreground.
  Recovery retains the route and replays the camera command after the map loads.
- A manual CoPilot setup request waits for automatic restoration instead of
  disappearing behind the in-flight startup check.
- A new foreground session refreshes its own map inventory after an older query
  completes. Results from backgrounded sessions cannot establish readiness.
- Sign-in now requires a confirmed secure-storage write. A failed write gives an
  actionable error instead of publishing a session that cannot survive restart.
- The device APK workflow requires a valid public display-map token and checks
  every packaged native library, APK ZIP alignment, and APK signature.

## Verification

`npm run check` passes: TypeScript, ESLint, 60 Jest suites / 923 tests, native
bridge/codegen checks, and 9 native-alignment tooling tests. The new regressions
cover actual recovery and concurrent-startup failures; test doubles do not prove
CoPilot licensing, routing or guidance on a device.

The currently deployed `/health` endpoint reports a healthy database and
configured Trimble routing. This is configuration evidence, not a successful
authenticated route request. It also reports disabled billing, unconfigured ELD
encryption and unconfigured Mapbox traffic.

The previous successful Android artifact from commit
`d0964eec58be41cc2b62f5397f49d32269dffb52` contains the configured backend and a
public Mapbox token. All 17 packaged ARM64 native libraries pass ELF alignment
and RELRO-layout checks; their uncompressed ZIP entries are aligned to 16 KB.
No 16 KB device run or release AAB test has been performed. The workflow repeats
binary checks for the new APK before upload.

## Required to finish truck navigation

1. Verify the device's assigned AMS company/asset identity, full-navigation,
   heavy-truck and regional entitlements using the embedded setup screen. Keep
   provider credentials out of source control and logs.
2. Download the licensed CoPilot map regions covering the complete test route
   and reroute corridor, and verify installed inventory and voice availability.
   Mapbox offline packs do not satisfy this requirement.
3. Obtain the supported Trimble mapping or native extension for mandatory axle
   and trailer restrictions and other currently unrepresentable profile fields.
   Implement the real native guidance adapter only with that mapping. The current
   `NativeGuidanceAdapter` inherits an unavailable engine and cannot start
   navigation, even when maps and licenses are present.
4. Connect and validate the SDK's actual route, maneuver, voice, progress,
   off-route, reroute and arrival callbacks. Demonstrate one real truck session
   with verified profile readback, permissions, foreground/background transitions,
   screen-off behavior, GPS loss and recovery on a physical Android device.

Do not enable guidance by bypassing the profile gate, dropping restrictions,
or treating backend preview geometry as proof of a native CoPilot route.

## Other unfinished dependencies

Server billing and ELD provider credentials/encryption need configuration and
integration checks before purchases or ELD syncing can be called operational.
Live parking, diesel-price, traffic and DOT coverage must be verified with their
actual providers; empty results remain unknown coverage. iOS still requires the
separately delivered CPIK frameworks and macOS/Xcode/device validation.

The September startup review brief is preparation for an AMS licensing
walkthrough; it contains no completed device-activation or navigation evidence.
