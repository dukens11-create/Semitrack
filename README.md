# Semitrack Phase 5 Backend Pack

## Downloading the Android APK

Every push and pull request automatically triggers a GitHub Actions workflow that builds a release APK.

**To download the APK after a successful run:**

1. Go to the **Actions** tab in this repository on GitHub.
2. Click on the latest **Build Release APK** workflow run.
3. Scroll down to the **Artifacts** section at the bottom of the run summary.
4. Click **app-release** to download the `app-release.apk` file.

The APK is built from `build/app/outputs/flutter-apk/app-release.apk` and is available for download for 90 days after the workflow run.

## Build Tooling Versions

The project is configured with the following minimum tooling versions:

| Tool | Version | Minimum Required |
|------|---------|-----------------|
| Kotlin Gradle Plugin (KGP) | **2.1.0** | 2.1.0 |
| Android Gradle Plugin (AGP) | **8.6.0** | 8.2.0 |
| `flutter_tts` | **4.0.2** | — |

### Current settings

**`android/build.gradle`** — Kotlin version:
```gradle
ext.kotlin_version = '2.1.0'
```

**`android/settings.gradle`** — AGP version:
```gradle
id "com.android.application" version "8.6.0" apply false
```

### Kotlin / AGP / flutter_tts Compatibility Notes

- **Kotlin 2.1.0** requires AGP **≥ 8.2.0**. AGP 8.1.x and older are incompatible with KGP 2.1.0.
- **Flutter** (as of stable 3.x) warns when AGP is below **8.6.0** and will drop support for older versions soon. Using AGP 8.6.0 avoids that deprecation warning.
- `flutter_tts` **≥ 4.2.0** requires Kotlin **2.2.x**, which is not yet widely available. `pubspec.yaml` is therefore pinned to **4.0.2** — the last release known to work with Kotlin 2.1.0.

### After merging

> **Important:** After merging any change to `android/build.gradle`, `android/settings.gradle`, or
> `pubspec.yaml`, always run the following commands to clean build artifacts and rebuild:
> ```bash
> flutter clean
> flutter build apk
> ```
> Skipping `flutter clean` after a tooling-version change often causes stale build errors.

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
