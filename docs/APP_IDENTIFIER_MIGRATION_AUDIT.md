# Semi-Trax application identifier migration audit

Date: 2026-08-31

No application identifier was changed during subscription Phase 2. Store publication history is not available in the repository, so changing an identifier without confirming the existing Google Play and App Store records could create a separate application instead of an update.

## Current identifiers

- Android namespace: `com.example.semitrack_mobile`
- Android default application ID: `com.example.semitrack_mobile`
- Android production override: Gradle property `SEMITRACK_APPLICATION_ID`
- iOS bundle ID in all committed build configurations: `com.example.semitrackMobile`
- Proposed Android and iOS identifier: `com.semitrax.app`

## Android migration impact

- `android/app/build.gradle` contains both the namespace and default application ID.
- Kotlin sources are under `android/app/src/main/kotlin/com/example/semitrack_mobile` and declare the same package.
- `MainActivity`, the navigation method-channel implementation, and `NavigationForegroundService` import classes through that package.
- The foreground service and launcher activity use relative class names in `AndroidManifest.xml`, so the native namespace and Kotlin package must be migrated together.
- Release signing is present only as Gradle property placeholders. No release keystore is committed. The production keystore/application signing identity must be confirmed before changing the package ID.

## iOS migration impact

- `ios/Runner.xcodeproj/project.pbxproj` uses `com.example.semitrackMobile` for Debug, Profile, and Release.
- The committed project uses the generic `iPhone Developer` signing identity.
- No Apple Developer team ID, provisioning profile, App Store Connect app ID, or push entitlement is committed.
- A new bundle ID requires a matching Apple App ID and provisioning profiles. If the current bundle is already published, changing it creates a different App Store application.

## Connected-service audit

- Firebase: no `google-services.json`, `GoogleService-Info.plist`, Firebase dependency, or Firebase initialization was found.
- Deep links/application links: no Android VIEW/BROWSABLE link intent filters, iOS URL schemes, or associated-domain entitlements were found.
- Mobile OAuth callbacks: none were found. Backend ELD OAuth callbacks for Samsara and Motive are configured independently with `SAMSARA_REDIRECT_URI` and `MOTIVE_REDIRECT_URI`.
- Push notifications: Android declares notification permission, but no Firebase Cloud Messaging configuration was found. No iOS APNs entitlement or provider configuration was found.
- Native channel: `com.semitrax/screen_awake` is a Flutter method-channel name, not an application identifier, and does not need to change.

## Required confirmation before migration

1. Whether an Android build has been published or uploaded under `com.example.semitrack_mobile` or a `SEMITRACK_APPLICATION_ID` override.
2. Whether an iOS build has been created or published under `com.example.semitrackMobile`.
3. The permanent Google Play package name and Apple bundle/App Store records.
4. Android upload/app-signing certificate ownership and Apple team/provisioning ownership.
5. New Firebase, OAuth, application-link, and push configuration if those services are added later.
