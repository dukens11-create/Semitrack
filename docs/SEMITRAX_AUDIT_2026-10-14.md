# Restored SemiTraX audit — 2026-10-14

Source: `codex/original-trimble-map-display` at f473c2d. This is the restored React Native application, not the discarded migration branch.

## Changes

- The APK workflows now pass MAPBOX_PUBLIC_TOKEN, the variable consumed by the configuration generator. Token existence/validity still requires CI/runtime verification.
- Configuration tests run in the normal check command. Fixed the release diagnostics test to provide its required public token.
- Opt-in `-PsemitraxTestAsset=true` creates a separate `com.semitrax.app.restored.copilot.testasset` debug package. On a fresh designated Samsung SM-S908U, it supplies `LicenseMgtInfo("TestAsset", "XGNKEA")`. It retains the previously verified local SDK Device ID `SemiTraX-Android-Test-01`. This follows Finn's request to change the asset, while retaining his prior local Device ID instruction; Trimble/device acceptance remains required.
- Ordinary builds and existing saved assignments retain their identities. Release builds disable test enrollment. No logout, license removal, app uninstall, or map deletion is performed. Do not run the old and diagnostic apps simultaneously; do not approve automatic map downloads as evidence of login acceptance.
- Diagnostic exports identify the TestAsset build, retaining the existing redaction and bounded timeline.
- Compatible dependency updates remove all seven production backend npm advisories. A qs override is needed because Express pins an affected minor range. Mobile production-tree advisories decrease from 40 to 34, with the critical shell-quote advisory removed. Remaining mobile advisories include build tooling; automatic recommendations include incompatible framework downgrades, which were not applied. These audit counts do not establish exploitability or complete security.

## Verification

Baseline mobile: 904 tests passed, typecheck/lint and native wiring passed. New native policy checks: 54 passed. Tooling/configuration: 15 passed. Backend after updates: 317 passed, 43 database-dependent tests skipped. Admin production build passes with explicit VITE_API_URL.

Live /health: API and database OK; Trimble configured. Mapbox traffic, ELD encryption and billing are disabled/unconfigured. No live deployment changed during this audit.

## Authentication source for Finn

Full implementation (not excerpts):
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java
- CoPilotCredentialPolicy.java, CoPilotEnrollmentPolicy.java, CoPilotDeviceReadbackPolicy.java and CoPilotLoginTrace.java in the same directory
- apps/mobile-react-native/android/app/build.gradle
- apps/mobile-react-native/src/services/copilot/CopilotProvider.tsx
- apps/mobile-react-native/src/services/copilot/CoPilotHost.ts
- apps/mobile-react-native/patches/trimble-maps-cpik-react-native-library+10.28.2-497.patch

The APK workflow packages these exact source files as authentication-source.tar.gz, with build commit and package identity. It contains no device keystore, credentials, or downloaded maps.

## Still blocked / not verified

1. No phone/ADB connection is available in this workspace. TestAsset login and the SDK timeline must be collected on the Samsung. Existing activation conflict remains a hypothesis from Finn.
2. No Android SDK is installed locally; native APK compilation is delegated to GitHub Actions. Unit/source checks are not compilation evidence.
3. Original APK signing key is not available here. The separate diagnostic package avoids replacing the installed package, but does not solve stable future updates or production signing.
4. Native truck restriction parity, native route coverage, reroute/voice guidance, and physical-device acceptance remain required. Guidance gates stay closed.
5. iOS CoPilot framework delivery and licensed device acceptance remain open.
6. Remaining mobile advisories, live traffic, ELD encryption and billing need further work. Do not treat this as production launch approval.
