# Semitrack Phase 5 Backend Pack

## Downloading the Android APK

Every push and pull request automatically triggers a GitHub Actions workflow that builds a release APK.

**To download the APK after a successful run:**

1. Go to the **Actions** tab in this repository on GitHub.
2. Click on the latest **Build Release APK** workflow run.
3. Scroll down to the **Artifacts** section at the bottom of the run summary.
4. Click **app-release** to download the `app-release.apk` file.

The APK is built from `build/app/outputs/flutter-apk/app-release.apk` and is available for download for 90 days after the workflow run.

## Kotlin / flutter_tts Compatibility Note

`kotlin-gradle-plugin` **2.2.x** is not yet available in public Maven repositories (Google or Maven Central).
The build is therefore pinned to **Kotlin 2.0.0** in `android/build.gradle`:

```gradle
ext.kotlin_version = '2.0.0'
```

`flutter_tts` ≥ 4.2.0 requires Kotlin 2.2.x, so `pubspec.yaml` is pinned to **4.0.2** — the last release
known to work with Kotlin 2.0.0.

**When `kotlin-gradle-plugin` 2.2.x (or later) is published**, you can:
1. Bump `ext.kotlin_version` in `android/build.gradle` to the desired 2.2.x version (e.g., `2.2.0`).
2. Upgrade `flutter_tts` in `pubspec.yaml` to the latest compatible version.
3. Run the following commands to clean build artifacts and verify the app builds:
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
