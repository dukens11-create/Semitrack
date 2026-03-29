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
| Kotlin Gradle Plugin | **2.1.0** | `android/build.gradle` (`ext.kotlin_version`) |
| Android Gradle Plugin (AGP) | **8.2.0** | `android/build.gradle` (classpath) and `android/settings.gradle` (plugins DSL) |
| flutter_tts | **^4.0.2** | `pubspec.yaml` |

`flutter_tts` **4.0.2** is the last release known to work with Kotlin 2.x without requiring 2.2.x or later.
`pubspec.yaml` is therefore pinned to `^4.0.2` until `kotlin-gradle-plugin` 2.2.x (or later) is available.

**Next steps — when `kotlin-gradle-plugin` 2.2.x (or later) is published:**
1. Bump `ext.kotlin_version` in `android/build.gradle` to the desired 2.2.x version (e.g., `2.2.0`).
2. Update the AGP version in both `android/build.gradle` and `android/settings.gradle` if a newer version is required.
3. Upgrade `flutter_tts` in `pubspec.yaml` to the latest compatible version.
4. Run the following commands to clean build artifacts and verify the app builds:
   ```bash
   flutter clean
   flutter build apk
   ```

> **Reminder:** After merging any change to `android/build.gradle` or `pubspec.yaml`, always run
> `flutter clean && flutter build apk` locally (or let CI confirm a green build) before releasing.

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
