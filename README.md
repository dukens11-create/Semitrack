# Semitrack Phase 5 Backend Pack

## Downloading the Android APK

Every push and pull request automatically triggers a GitHub Actions workflow that builds a release APK.

**To download the APK after a successful run:**

1. Go to the **Actions** tab in this repository on GitHub.
2. Click on the latest **Build Release APK** workflow run.
3. Scroll down to the **Artifacts** section at the bottom of the run summary.
4. Click **app-release** to download the `app-release.apk` file.

The APK is built from `build/app/outputs/flutter-apk/app-release.apk` and is available for download for 90 days after the workflow run.

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
