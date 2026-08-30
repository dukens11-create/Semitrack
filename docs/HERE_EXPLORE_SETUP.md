# HERE SDK Explore for Flutter 4.27.2.0

## Current integration boundary

SemiTrack's backend HERE Routing v8 integration is active in source and uses truck transport mode. The official HERE SDK Explore Flutter 4.27.2 plugin has now been extracted from the downloaded HERE bundle to the ignored local path `plugins/here_sdk` and is referenced by `pubspec.yaml`. The application initializes `SdkContext`, `SDKNativeEngine`, and `SearchEngine` through `HereSdkService`; debug launches use a fixed public coordinate search to distinguish accepted credentials from a network-unavailable check without logging credential values.

The SDK engine and online credential probe still need to run on an Android device or emulator. Explore does not provide the licensed Navigate-only guidance capabilities listed below.

## Installed official package

The local package was installed by extracting the downloaded bundle to
`plugins/here_sdk`. This path is ignored because the SDK is licensed and
proprietary. The application references it with:

   ```yaml
   here_sdk:
     path: plugins/here_sdk
   ```

Official 4.27.2 integration requirements include Android `minSdk 24`, `compileSdk 36`, `targetSdk 36`, and iOS deployment target 15.2. Do not mix a standalone Android AAR with the Flutter plugin; the official plugin includes and registers the platform components it needs.

## Credentials

The formerly tracked `credentials.properties` contained populated HERE credentials and has been removed from the active tree. Rotate/revoke its access-key secret and any associated client credential in HERE Access Manager before using replacements.

HERE's downloaded `credentials.properties` is a credential container, not a
Flutter/Gradle dependency file. Store the populated local file at:

```text
config/here/credentials.properties
```

That exact path is ignored by Git. The safe tracked template is
`config/here/credentials.properties.example`. Do not rename or modify the
backend `apps/api/.env`; its `HERE_API_KEY` is a separate REST credential.

HERE's Java-properties file commonly contains spaces around `=`, which Flutter's
`.env` parser does not accept directly. The checked-in helper parses the local
file, creates a temporary JSON define file containing only the access key ID and
secret, invokes Flutter, and removes that temporary file in a `finally` block.
`HereSdkConfig` reads those compiler-provided values without putting either
value in Dart, Kotlin, or Swift source.

For local validation and Android builds, use the checked-in helper. It validates
only the presence of the required keys and never prints their values:

```powershell
.\tools\here_flutter.ps1 validate
.\tools\here_flutter.ps1 test-config -FlutterCommand C:\path\to\flutter\bin\flutter.bat
.\tools\here_flutter.ps1 build-android -FlutterCommand C:\path\to\flutter\bin\flutter.bat
.\tools\here_flutter.ps1 run -FlutterCommand C:\path\to\flutter\bin\flutter.bat
```

Mobile SDK credentials necessarily ship in the compiled client, so use an
app-specific credential with the restrictions and rotation policy supported by
HERE; never reuse server credentials.

The server-side REST routing key remains `HERE_API_KEY` in `apps/api/.env`, which is also excluded from source control.

## Explore adapter boundary

Keep HERE SDK calls behind small adapters rather than adding them to the large map screen:

- `HereSdkService`: implemented one-time `SdkContext`/`SDKNativeEngine` initialization, `SearchEngine` credential probe, and lifecycle disposal.
- `HereMapController`: `HereMap`, camera, day/night scenes, route polylines, truck marker, traffic layers.
- `HereExploreRoutingService`: `RoutingEngine` truck routes, waypoints, alternatives, sections/spans/notices, ETA and traffic delay.
- `HereSearchService`: debounced `SearchEngine` suggestions/geocoding for U.S./Canada.
- `HereTrafficService`: Explore traffic flow/incidents supported by the supplied license.

Existing Flutter UI, profiles, POIs, authentication, and backend remain unchanged. Explore route planning may coexist with the authoritative server route only after both results are verified to use the same truck profile and fail-closed policy.

## Navigate-only boundary

Do not represent these Explore limitations as completed navigation:

- VisualNavigator/map matching
- maneuver and lane notifications during guidance
- production voice guidance
- dynamic native rerouting and arrival lifecycle
- native offline truck navigation
- Android Auto

Those capabilities remain behind the existing Flutter MethodChannel/EventChannel and deliberately return `TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE` until HERE grants Navigate access. The Explore credential must not be used to bypass Navigate licensing.

## Verification commands

After placing the official plugin:

```powershell
flutter clean
flutter pub get
flutter analyze
flutter test
.\tools\here_flutter.ps1 build-android `
  -FlutterCommand C:\path\to\flutter\bin\flutter.bat
```

iOS must be validated on macOS with Xcode after setting the Runner deployment target to 15.2 and confirming the plugin's `heresdk.xcframework` embedding/signing settings.
