# CoPilot v11 integration candidate

## Current delivery — November 13, 2026

Finn supplied a renewed authorized share containing 11.4.0.2142_CoPilot_React_Native.zip. The outer archive SHA-256 is `a5c5c0fd63cef6e1acc92d2816db8c8cc79f33e7a6c73b2746545bc726e6b571`; package.json identifies `11.4.0-2142`. Both the browser download and direct HTTPS download produced identical bytes, and ZIP integrity verification passed. Vendor bytes and private URLs remain outside git.

The preparation script now pins this exact delivery. CPIKReactNativeLibrary.zip has package.json at its root rather than in a CPIKReactNativeLibrary subdirectory. The vendor has empty dependency/devDependency maps and uses React Android 0.85.0. Preparation preserves one RN runtime by declaring the app peer, removes the reviewed exact Gradle version pin, and retains the foreground notification icon correction. Unexpected checksums, versions, paths and patch sources still fail closed. The local dependency lock records 11.4.0-2142.

Local checks passed with this SDK: TypeScript, zero-warning ESLint, 75 Jest suites / 1,020 tests, Android/iOS bridge code generation and wiring, nine page-size tooling tests, Java handoff/start helpers, and eight preparation tests. All four delivered native ABIs pass the existing 16 KB ELF load-segment alignment test; this is not final APK alignment or device acceptance.

Public Java API inspection confirms VehicleDimensions now exposes trailer count, bumper-to-bumper length and maximum straight length. No truck safety gate is removed by this SDK preparation change. These APIs require a separate semantics/readback integration review before representing additional truck specifications. CopilotVersion.getAppVersion remains available.

CI download-secret renewal completed on November 13, 2026 at 23:54 UTC; GitHub confirmed the secret update. A fresh candidate push requests the APK workflow with the verified delivery. Native Android compilation, final signing verification and physical-device testing remain pending. Do not rerun the obsolete candidate to claim validation of these changes.

## Historical October 27 delivery


This branch consumes the private Android SDK delivered by Trimble support in case 02405327 on October 27, 2026. The outer ZIP is named 11.3.0.2106_CoPilot_React_Native.zip, but package.json identifies 11.3.0-2016 and the arm64 libcopilot.so version string identifies 11,3,0,2016. Do not claim a 2106 binary.

The SHA-256 of the full delivered ZIP is c5db24a1ae9feca69fd0726faf59337803b46407fface803534d16cc8a688de7. The preparation script refuses different bytes and checks extraction paths. Vendor files and the download URL are excluded from version control.

## Build preparation

Before npm ci in apps/mobile-react-native, run `npm run prepare:copilot` with either SEMITRAX_COPILOT_ARCHIVE pointing at the downloaded outer ZIP, or SEMITRAX_COPILOT_SDK_URL containing the direct HTTPS download link supplied by support (share URL with /download appended).

For GitHub Actions, an administrator must store that direct download URL as the repository Actions secret SEMITRAX_COPILOT_SDK_URL. No secret was created by this change. The build workflow consumes the secret before npm ci. Never put the URL into package.json, package-lock.json, workflow source, or issue comments.

The script prepares vendor/copilot as the local npm dependency. It replaces the vendor's RN 0.79.5 nested dependency with a peer on the app's RN 0.85.0, removes the hardcoded Gradle React version so the RN plugin manages it, and applies the existing foreground-notification icon fix. The new delivery combines the Java SDK into classes.jar; the host compile-only dependency points there. Diagnostics read the running SDK version through CopilotMgr rather than reporting a hardcoded v10 value.

## Verified locally

- Original ZIP fingerprint and delivered package version.
- Public Java API inspection: MapInfo uses long for sizes; CopilotVersion exposes getAppVersion.
- VehicleDimensions exposes dimensions, total weight and weight per axle. No public axle-count or trailer-count/type setters were found on VehicleDimensions or VehicleRoutingProfile. Truck restriction guards remain intact.
- Vendor native-library ELF alignment checks pass; this does not establish final APK alignment or device behavior.
- Preparation tests reject checksum mismatches, path traversal and unexpected patch input.

## Required acceptance

Run npm run check after preparation. Compile the Android APK with the persistent test signing configuration, verify the final package/signature, and test startup/license readback, existing offline maps, map preview, background/resume and SDK version on the licensed phone. Do not uninstall, clear data, change application ID, or replace the signing key. OpenGL remains enabled. No production release or navigation-readiness claim is made.

Native compilation for v11 is pending private SDK secret configuration. The earlier successful APK from PR #397 uses v10 and is not evidence of a successful v11 build.
