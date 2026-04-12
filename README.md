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
