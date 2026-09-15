# Semitrack Phase 5 Backend Pack

## Firebase Setup

This project uses [FlutterFire](https://firebase.flutter.dev/) for Firebase integration.

The files `lib/firebase_options.dart`, `android/app/google-services.json`, and `ios/Runner/GoogleService-Info.plist` are currently populated with **placeholder values**. Before running the app you must replace them with real credentials from your Firebase project.

### Regenerate configs with the FlutterFire CLI

```bash
# Install the CLI (one-time)
dart pub global activate flutterfire_cli

# From the project root, configure all platforms
flutterfire configure --project=semitrack
```

This will overwrite `lib/firebase_options.dart`, `android/app/google-services.json`, and `ios/Runner/GoogleService-Info.plist` with real values tied to your `semitrack` Firebase project.

After regenerating, run:

```bash
flutter clean
flutter pub get
flutter run
```

## Mapbox setup

Map rendering uses two different Mapbox credentials. Never commit either
credential to this repository.

- `MAPBOX_ACCESS_TOKEN` is the public `pk.` token supplied to Flutter with
  `--dart-define`.
- `MAPBOX_DOWNLOADS_TOKEN` is a secret `sk.` token with `Downloads:Read`, kept
  in the user's Gradle properties or CI secrets so Gradle can download the
  native Mapbox Maps SDK.

For a local Windows build, save the secret token in
`C:\Users\<username>\.gradle\gradle.properties`:

```properties
MAPBOX_DOWNLOADS_TOKEN=YOUR_PRIVATE_SK_TOKEN
```

For local Mapbox-enabled builds, copy the public-token template and fill only the
`pk.` value. The real file is ignored by Git:

```powershell
Copy-Item config\mapbox\credentials.properties.example config\mapbox\credentials.properties
notepad config\mapbox\credentials.properties
```

`tools\here_flutter.ps1 build-android` and `run` load that file automatically.
You can alternatively build with the public token in the environment:

```powershell
flutter build apk --debug --dart-define=MAPBOX_ACCESS_TOKEN=$env:MAPBOX_ACCESS_TOKEN
```

GitHub Actions requires repository secrets named `MAPBOX_ACCESS_TOKEN` and
`MAPBOX_DOWNLOADS_TOKEN`.

## Production and Android release configuration

The API must run with `NODE_ENV=production` and explicit values for
`DATABASE_URL`, `JWT_SECRET` (at least 32 characters), `ACCESS_TOKEN_MINUTES`,
`REFRESH_TOKEN_DAYS`, `PUBLIC_API_URL`, and `CORS_ORIGINS`. Production public
URLs and CORS origins must use HTTPS and cannot point at localhost. See
`apps/api/.env.example`; startup fails immediately when this configuration is
missing or unsafe.

Release Flutter builds must supply an HTTPS backend endpoint:

```powershell
flutter build apk --release --dart-define=SEMITRACK_API_URL=https://api.example.com --dart-define=MAPBOX_ACCESS_TOKEN=$env:MAPBOX_ACCESS_TOKEN
```

Android release builds use `com.semitrax.app` by default. Override it only with
the Gradle property or environment variable `SEMITRACK_APPLICATION_ID`. Release
signing requires `SEMITRACK_RELEASE_STORE_FILE`,
`SEMITRACK_RELEASE_STORE_PASSWORD`, `SEMITRACK_RELEASE_KEY_ALIAS`, and
`SEMITRACK_RELEASE_KEY_PASSWORD`; a release task fails instead of falling back
to debug signing.

The APK workflow additionally requires the base64-encoded keystore secret
`SEMITRACK_RELEASE_KEYSTORE_BASE64` plus the three signing secrets above.

Trimble remains the authoritative commercial-truck routing provider. Mapbox is
used for map display only; it is not a passenger-navigation fallback. Native
turn-by-turn guidance remains fail-closed until a separately licensed and
validated commercial-truck guidance SDK is integrated.

## Downloading the Android APK

Every push and pull request automatically triggers a GitHub Actions workflow that builds a release APK.

**To download the APK after a successful run:**

1. Go to the **Actions** tab in this repository on GitHub.
2. Click on the latest **Build Release APK** workflow run.
3. Scroll down to the **Artifacts** section at the bottom of the run summary.
4. Click **app-release** to download the `app-release.apk` file.

The APK is built from `build/app/outputs/flutter-apk/app-release.apk` and is available for download for 90 days after the workflow run.

## Kotlin / AGP / flutter_tts Compatibility Note

The Android build is currently configured with:

| Component | Version | File |
|---|---|---|
| Kotlin Gradle Plugin | **2.2.20** | `android/build.gradle` (`ext.kotlin_version`) and `android/settings.gradle` (plugins DSL) |
| Android Gradle Plugin (AGP) | **8.6.0** | `android/build.gradle` (classpath) and `android/settings.gradle` (plugins DSL) |
| Gradle wrapper | **8.11.1** | `android/gradle/wrapper/gradle-wrapper.properties` |
| flutter_tts | **^4.0.2** | `pubspec.yaml` |

### Compatibility constraints

- AGP 8.6.0 requires **Gradle 8.7 or higher** (the wrapper is set to 8.11.1 — no change needed).
- **AGP 8.6.0 requires JDK 17.** Codemagic is configured with `java: 17`. If building locally, make sure your `JAVA_HOME` points to a JDK 17 installation.
- Kotlin 2.2.20 resolves the `compilerOptions {}` DSL incompatibility that affected `flutter_tts` and `shared_preferences_android` 2.4.1+ with older KGP versions.
- Flutter 3.x will emit a build warning and eventually drop support for AGP < 8.6.0; this upgrade resolves that warning.

### After merging

Run the following commands locally to clean build artifacts and verify the app builds successfully:

```bash
flutter clean
flutter pub get
flutter build apk --release
```

> **Reminder:** After merging any change to `android/build.gradle`, `android/settings.gradle`, or `pubspec.yaml`, always run
> `flutter clean && flutter pub get && flutter build apk --release` locally (or let CI confirm a green build) before releasing.

Includes:
- Prisma schema
- ELD integrations
- Samsara adapter
- Motive scaffold
- Fuel-card scoring
- Messaging routes
- Maintenance routes
- Compliance routes
- S3 upload service
- Stripe webhook route
- Background job scaffold
