# SemiTraX production mobile client

This is the single production mobile implementation. Root Flutter code is LEGACY / REFERENCE ONLY — NOT PRODUCTION CLIENT. This designation does not certify migration completion or store readiness. See ../../docs/REACT_NATIVE_PRODUCTION_STATUS.md for current evidence and FEATURE_BOUNDARIES.md for capability limits.

## Architecture

React Native 0.85.0, React 19.2.3, strict TypeScript, native-stack navigation, platform Keychain/Keystore, Mapbox display and public geocoding, existing SemiTraX HTTP APIs, code-generated Kotlin / Objective-C++ / Swift native boundaries. Expo Go is not used. Native projects remain directly editable for the future official Trimble SDK.

## Configure and validate

Use Node 22.13.x, 24.3+ or 25+ (validated with Node 24.16.0). Run:

```sh
npm ci
# Set SEMITRAX_API_URL and MAPBOX_PUBLIC_TOKEN in the process environment.
npm run configure
npm run check
npm start
```

PowerShell configuration example (replace placeholders with approved values):

```powershell
$env:SEMITRAX_API_URL = 'https://YOUR-APPROVED-BACKEND'
$env:MAPBOX_PUBLIC_TOKEN = 'pk.YOUR-PUBLIC-DISPLAY-TOKEN'
npm run configure
npm run android
```

The empty default refuses to create an API client and shows configuration required. Debug can use explicitly configured HTTP emulator endpoints. Release requires public HTTPS and rejects malformed URLs, embedded credentials, loopback, emulator and private hosts. Native release build hooks regenerate configuration with the same validator. Only a public pk. Mapbox token is accepted. generated.ts is ignored and recreated after npm ci. Never copy server .env files into this app.

## Android

Install JDK 17+ compatible with the pinned Gradle/AGP toolchain, Android SDK platform 36, Build Tools 36.0.0 and NDK 27.1.12297006. Set ANDROID_HOME or ignored android/local.properties. SDK packages/licenses must be installed by the build operator. Run npm run android or android/gradlew assembleDebug.

Production applicationId remains com.semitrax.app. Debug is com.semitrax.app.migration.debug to keep development identity separate from the production package. VersionCode 1 is a foundation placeholder; choose a Play-compatible increment only after verifying the existing listing. The release build is unsigned; no debug signing fallback or keystore is included. Play/Firebase ownership, signing key/certificate continuity and foreground-service declarations must be verified externally before release. Nothing is registered or published.

LocationManager supplies real precise fixes. Preview tracking stops when the app backgrounds. The explicit background path uses a user-started location foreground service with required service-type permissions and notification. No boot/background auto-start is configured. Test denial, approximate permission, GPS disabled, screen-off, foreground/background transitions, task dismissal and process recreation on real devices before enabling background workflows.

## iOS

On macOS install Xcode and CocoaPods using the template Gemfile. Run npm ci; cd ios; bundle install; bundle exec pod install; open SemiTrax.xcworkspace. Configure signing in the verified Apple Developer team. The proposed release bundle ID is com.semitrax.app; debug is com.semitrax.app.migration.debug. They are source configuration only and have not been registered or verified externally.

The project includes CoreLocation permission descriptions/background capability and Swift location/guidance classes connected through a generated TurboModule adapter. Background tracking requires a separate Always-permission upgrade and remains unavailable if iOS defers it. Full-accuracy authorization is required. Native compilation, privacy review, signing, permissions and background behavior need a macOS/device validation pass.

## Providers and secrets

- The existing server retains Trimble credentials, truck restrictions and OverrideRestrict=false.
- MAPBOX_PUBLIC_TOKEN enables map display and address geocoding. The pinned rnmapbox installation documentation says Android Mapbox downloads no longer require a private download token. Do not add a private token to JavaScript. If a vendor download credential is required by an approved future SDK/version, keep it only in native dependency tooling or CI.
- HERE POI credentials, DOT feed configuration, database/JWT/CORS/HTTPS protections, ELD OAuth and billing configuration stay on the server.
- No Firebase SDK or placeholder configuration is ported. Firebase setup is optional future work after identifier ownership is established.
- Auth tokens live in Keychain/Keystore. Session updates are serialized; failed network refresh retains tokens, invalid refresh clears them.

## Safety and limits

All truck route requests use /routing/truck-route with the full ordered remaining stop list and the current precise origin. Trimble failure is explicit; there is no passenger routing request. A failed recalculation preserves the prior preview and plan. Maneuver offsets are actual backend geometry positions, not maneuver indices; monotonicity, bounds and the backend 250-meter confidence ceiling are validated.

Start navigation returns NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED. No simulated route progress, speed limit, turn announcement or arrival is produced. Preserve the existing official CPIK preparation and gating. Native startup, licensing, map packages, truck-profile parity and device acceptance are not yet verified.

Run npm run check:native for bridge generation and static wiring checks. These checks do not compile native source. The initial Android build was blocked by a Windows Gradle JAR AccessDeniedException before app compilation; this checkout specifies Android platform/build-tools 36. iOS build requires macOS. See the migration report for exact tests, npm advisory findings and remaining parity work.


## CoPilot preparation

The official Android CPIK package is pinned and autolinked. It is not initialized or operational. Read COPILOT_INTEGRATION_AUDIT.md for native setup, the 16 KB evidence and release gate, API audit, and licensing/profile blockers. Run npm run copilot:check for the developer readiness report (expected failure until blockers are resolved). iOS requires the separately delivered frameworks described in ios/COPILOT_SETUP.md.

The latest P0 findings and exact external actions are in COPILOT_P0_REPORT.md.
Configuration/provisioning interfaces and a profile assessment now reject missing
prerequisites and unrepresentable restrictions. They do not start or simulate CPIK.
