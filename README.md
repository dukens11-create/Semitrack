# SemiTraX

**React Native is the single production mobile client:** [apps/mobile-react-native](apps/mobile-react-native/README.md).
Designation as the production client is not a claim of completed migration, licensed navigation, or store readiness.

| Component | Authoritative location |
| --- | --- |
| Mobile entry point | apps/mobile-react-native/index.js → App.tsx → src/app/AppRoot.tsx |
| Android project | apps/mobile-react-native/android |
| iOS project | apps/mobile-react-native/ios |
| Production API | apps/api |
| Staff Admin | apps/admin |
| Legacy/reference mobile | Root lib/, android/, ios/, pubspec.yaml and tools/here_flutter.ps1 / tools/refresh_phone.ps1 |

React Native calls the SemiTraX API for authenticated commercial-truck routing. Trimble is the authoritative route provider. Mapbox displays accepted Trimble geometry and supplies geocoding; it must never calculate a passenger-car fallback. Official CoPilot/CPIK preparation remains gated until native startup, entitlement, maps, truck restrictions and device behavior are verified.

## Mobile development and validation

Run from apps/mobile-react-native, using the existing locked dependencies:

~~~powershell
npm ci
# Supply approved SEMITRAX_API_URL and MAPBOX_PUBLIC_TOKEN in this process.
npm run configure
npm run check
~~~

The approved API is https://semitrax-api.onrender.com. Public Mapbox configuration must come from the approved local configuration; do not copy backend environment files or secret tokens into mobile source. The configuration-required guard stays enabled. Gradle release builds regenerate and validate public HTTPS configuration.

Build Android from apps/mobile-react-native/android with ./gradlew.bat assembleRelease on Windows (./gradlew on other hosts). Release output is unsigned unless separately approved signing is supplied. Inspect the resulting APK, every packaged native library and official zipalign before claiming 16 KB compatibility. Build iOS on macOS using the RN Podfile and SemiTrax Xcode workspace. Neither native project uses the root Flutter startup or channels.

## Backend and Admin

Use each application's package.json and lockfile. Root package.json/src are historical backend scaffolding, not the deployed API. Render configuration targets apps/api. Do not run migrations against production as part of local validation. Database tests require a disposable loopback PostgreSQL database and the existing isolated-database guard.

The existing GitHub workflow validates RN/API/Admin; it does not publish a Flutter APK or deploy production.

## Legacy material and completion limits

The preserved [Flutter setup reference](docs/legacy/FLUTTER_SETUP_REFERENCE.md) is **LEGACY / REFERENCE ONLY — NOT PRODUCTION CLIENT**. Keep original product assets/reference behavior available; do not copy obsolete architecture, synthetic defaults or unverified navigation into RN. RN assets needed at runtime are already under its own src/assets.

See [migration stabilization status](docs/REACT_NATIVE_PRODUCTION_STATUS.md) for source evidence and incomplete capabilities. Trips history, document storage, native device acceptance and licensed guidance must not be inferred from the five-tab UI. Do not begin the 44-feature expansion until migration blockers are cleared.
