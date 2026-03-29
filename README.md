# Semitrack Phase 5 Backend Pack

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
| Kotlin Gradle Plugin | **2.1.20** | `android/build.gradle` (`ext.kotlin_version`) |
| Android Gradle Plugin (AGP) | **8.6.0** | `android/build.gradle` (classpath) and `android/settings.gradle` (plugins DSL) |
| Gradle wrapper | **8.11.1** | `android/gradle/wrapper/gradle-wrapper.properties` |
| flutter_tts | **^4.0.2** | `pubspec.yaml` |

### Compatibility constraints

- AGP 8.6.0 requires **Gradle 8.7 or higher** (the wrapper is set to 8.11.1 — no change needed).
- **AGP 8.6.0 requires JDK 17.** Codemagic is configured with `java: 17`. If building locally, make sure your `JAVA_HOME` points to a JDK 17 installation.
- Flutter 3.x will emit a build warning and eventually drop support for AGP < 8.6.0; this upgrade resolves that warning.
- `flutter_tts ^4.0.2` is compatible with Kotlin 2.1.x; no pubspec.yaml change is required.

### shared_preferences_android version override

`pubspec.yaml` pins `shared_preferences_android` to **2.4.0** via `dependency_overrides`:

```yaml
dependency_overrides:
  shared_preferences_android: 2.4.0
```

Versions 2.4.1+ use the `compilerOptions {}` Kotlin Gradle DSL block, which is incompatible with the current KGP (2.1.20) and triggers a build failure. The pin keeps the build green until the upstream plugin is updated to handle this correctly.

> **TODO:** Remove the `dependency_overrides` entry once `shared_preferences_android` (or the Flutter plugin ecosystem) publishes a version that is compatible with KGP 2.1.x without the `compilerOptions {}` conflict.

### After merging

Run the following commands locally to clean build artifacts and verify the app builds successfully:

```bash
flutter clean
flutter pub get
flutter build apk
```

> **Reminder:** After merging any change to `android/build.gradle` or `pubspec.yaml`, always run
> `flutter clean && flutter pub get && flutter build apk` locally (or let CI confirm a green build) before releasing.

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
