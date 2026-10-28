# CoPilot v11 integration candidate

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
