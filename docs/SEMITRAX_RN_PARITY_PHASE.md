# SemiTraX React Native parity phase

## A. Source checkpoint

- Canonical repository: C:\Users\duken\Documents\Codex\2026-09-14\files-pasted-by-the-user-semitrax/backend-repair
- Branch: codex/semitrax-p0-contract-reconciliation
- Starting and current HEAD: c8af730a077b7873ecaeb40945c53f4262d1ffdd
- Navigation V2 source: C:\Users\duken\Documents\Codex\2026-09-14\files-pasted-by-the-user-semitrax/navigation-v2-source
- React Native target: C:\Users\duken\Documents\Codex\2026-09-14\files-pasted-by-the-user-semitrax/backend-repair/apps/mobile-react-native
- Flutter reference: C:/Users/duken/Documents/Codex/2026-09-03/semitrack-navigation-reimplementation/work/semitrack/lib
- No commit or push performed.
- Pre-existing changes preserved: mobile package.json/package-lock.json, mobile patches/, and untracked apps/api/0. They are not attributed to this parity pass.
- Source backups, test logs and hashes: C:\Users\duken\Documents\Codex\2026-09-14\files-pasted-by-the-user-semitrax/rn-parity-validation. Build copies/caches are outside the canonical Git repository.

### Working-tree status

```text
 M apps/mobile-react-native/__tests__/phase2-ui.test.tsx
 M apps/mobile-react-native/__tests__/route-contract.test.ts
 M apps/mobile-react-native/__tests__/stationary-location.test.ts
 M apps/mobile-react-native/package-lock.json
 M apps/mobile-react-native/package.json
 M apps/mobile-react-native/src/components/DriverSheet.tsx
 M apps/mobile-react-native/src/components/ui.tsx
 M apps/mobile-react-native/src/errors/driverErrors.ts
 M apps/mobile-react-native/src/features/dot511/CorridorRecords.tsx
 M apps/mobile-react-native/src/features/map/TruckMap.tsx
 M apps/mobile-react-native/src/features/poi/PoiPresentation.tsx
 M apps/mobile-react-native/src/features/poi/PoiService.ts
 M apps/mobile-react-native/src/features/search/DestinationSearchStore.ts
 M apps/mobile-react-native/src/models/contracts.ts
 M apps/mobile-react-native/src/navigation/AppNavigator.tsx
 M apps/mobile-react-native/src/screens/PlanningScreen.tsx
 M apps/mobile-react-native/src/screens/ServicesScreen.tsx
 M apps/mobile-react-native/src/screens/SettingsScreen.tsx
 M apps/mobile-react-native/src/services/guidance/NavigationEngine.ts
 M apps/mobile-react-native/src/services/location/LocationService.ts
?? apps/api/0
?? apps/mobile-react-native/__tests__/navigation-parity.test.tsx
?? apps/mobile-react-native/__tests__/parity-services-ui.test.tsx
?? apps/mobile-react-native/patches/
?? apps/mobile-react-native/src/features/eld/
?? apps/mobile-react-native/src/features/map/cameraPolicy.ts
?? apps/mobile-react-native/src/features/navigation/
?? apps/mobile-react-native/src/features/offline/
?? apps/mobile-react-native/src/features/poi/stationStatus.ts
?? apps/mobile-react-native/src/features/settings/mapPreferences.ts
?? apps/mobile-react-native/src/models/stopCoverage.ts
?? apps/mobile-react-native/src/screens/EldScreen.tsx
?? apps/mobile-react-native/src/screens/OfflineMapsScreen.tsx
?? docs/SEMITRAX_RN_PARITY_PHASE.md
```

## B. Implemented

1. Reconciled authoritative Navigation V2 PlanningScreen, TruckMap and DriverSheet. Other copied mobile source was compared; guidance engine and app service wiring already matched. Incoming generated configuration, caches, native build outputs and backup directories were not migrated.
2. Preserved visible Start Navigation before provisioning, real capability checks, Pause/Resume, confirmed End, retained route after End, map overview, compass, follow, numbered stops, alternatives and POIs.
3. Added modular navigation HUD, typed provider detail/event handling, lane arrows/recommendations and junction details. Route identity, engine phase, numeric validity and 15-second freshness gate live information. Preview uses accepted Trimble estimates. GPS speed uses real fresh fixes. Device-time ETA derives from the timestamp of provider progress, not a simulated countdown. Destination timezone is not guessed.
4. Added camera policy: explicit free-pan indicator, follow restoration, heading normalization, speed-based zoom, maneuver zoom only from real provider evidence and active-navigation pitch. Satellite and automatic zoom preferences are persisted through the existing settings API.
5. Added GPS jump rejection and a route spatial index built once per route. Route projection is advisory, intersections/loops remain unknown where ambiguous, and off-route indication needs distinct fixes spanning ten seconds. Projection never advances navigation or declares arrival. Traveled/remaining display geometry and current-leg index require an explicit mapped provider maneuver offset.
6. Added route-scoped warnings with source/distance evidence, stages, severity ordering, deduplication, expiry and session reset. High alerts require explicit acknowledgment; dismissal does not change truck restrictions. Warning state survives collapsing the panel. Refresh is explicit; no provider requests were made during implementation.
7. Category search prefers accepted-route corridor results with fresh GPS. Results require explicit distance ahead, are ordered/deduplicated and retain provider/access caveats. Details feed the existing confirmed StopPlan flow. Route edits during a navigation session are rejected until navigation ends.
8. Weigh-station corridor records retain direction/source evidence and unknown status when stale or absent. Community observations use existing authenticated API contracts after confirmation and fresh GPS. No OPEN/CLOSED status is inferred from a report submission.
9. Added Samsara/Motive connection, OAuth connect, sync, disconnect, last-sync and error UI. Authorization URLs are restricted to the backend's exact provider origins/paths. HOS remains UNKNOWN because the backend explicitly requires signed-in driver mapping. Legal ELD records are not edited.
10. Added Mapbox offline DISPLAY pack management using the installed RNMapbox API: confirmed small GPS-centered region, download progress, stored bytes, inventory and confirmed deletion. API reachability is labeled separately from Mapbox connectivity. No offline routing claim.
11. Added ELD/offline entry points under Services. Tab changes away from a real navigation session require confirmation. Existing Home/Map/Trips/Docs/More structure is retained.
12. Fixed RN stop acceptance to match the verified Trimble parser's 50 m provider-snap boundary, retaining exact ordered stop count, leg count and explicit provider evidence. Added acceptance/rejection regressions.
13. Added accessible labels to shared buttons for screen-reader and deterministic UI interaction.

### Task source/test inventory (36 files)

- apps/mobile-react-native/__tests__/phase2-ui.test.tsx
- apps/mobile-react-native/__tests__/route-contract.test.ts
- apps/mobile-react-native/__tests__/stationary-location.test.ts
- apps/mobile-react-native/src/components/DriverSheet.tsx
- apps/mobile-react-native/src/components/ui.tsx
- apps/mobile-react-native/src/errors/driverErrors.ts
- apps/mobile-react-native/src/features/dot511/CorridorRecords.tsx
- apps/mobile-react-native/src/features/map/TruckMap.tsx
- apps/mobile-react-native/src/features/poi/PoiPresentation.tsx
- apps/mobile-react-native/src/features/poi/PoiService.ts
- apps/mobile-react-native/src/features/search/DestinationSearchStore.ts
- apps/mobile-react-native/src/models/contracts.ts
- apps/mobile-react-native/src/navigation/AppNavigator.tsx
- apps/mobile-react-native/src/screens/PlanningScreen.tsx
- apps/mobile-react-native/src/screens/ServicesScreen.tsx
- apps/mobile-react-native/src/screens/SettingsScreen.tsx
- apps/mobile-react-native/src/services/guidance/NavigationEngine.ts
- apps/mobile-react-native/src/services/location/LocationService.ts
- apps/mobile-react-native/__tests__/navigation-parity.test.tsx
- apps/mobile-react-native/__tests__/parity-services-ui.test.tsx
- apps/mobile-react-native/src/features/eld/EldService.ts
- apps/mobile-react-native/src/features/map/cameraPolicy.ts
- apps/mobile-react-native/src/features/navigation/LaneGuidance.tsx
- apps/mobile-react-native/src/features/navigation/NavigationHud.tsx
- apps/mobile-react-native/src/features/navigation/RouteAdvisories.tsx
- apps/mobile-react-native/src/features/navigation/RouteProgressMonitor.ts
- apps/mobile-react-native/src/features/navigation/WarningManager.ts
- apps/mobile-react-native/src/features/navigation/guidanceEvents.ts
- apps/mobile-react-native/src/features/navigation/navigationPresentation.ts
- apps/mobile-react-native/src/features/navigation/routeDisplayProgress.ts
- apps/mobile-react-native/src/features/offline/offlinePolicy.ts
- apps/mobile-react-native/src/features/poi/stationStatus.ts
- apps/mobile-react-native/src/features/settings/mapPreferences.ts
- apps/mobile-react-native/src/models/stopCoverage.ts
- apps/mobile-react-native/src/screens/EldScreen.tsx
- apps/mobile-react-native/src/screens/OfflineMapsScreen.tsx

This report is an additional documentation file. Existing package/patch changes are preserved separately; build outputs, dependencies, scripts and logs outside Git are excluded.

## C. Already present and retained

- Trimble-only routing, strict route parsing, ordered stops and comparison-only alternatives.
- Verified/revision-bound truck profiles, measured dimensions/hazmat/avoidances and native representability checks.
- Server-backed trips, dispatch transitions, idempotency, refresh/revision checks and explicit routing confirmation.
- Server-backed document metadata, ownership/revision/idempotency and pending-create recovery.
- Keyboard driver assistant and verified-data intents; no fake microphone.
- Existing safety/weather/camera/fuel corridor viewers, account/security settings and secure session storage.

## D. Provider-gated

- CoPilot start/guidance/rerouting, live maneuvers, lane/junction data and speed limits remain unavailable until licensed native runtime, maps, entitlements and device acceptance are complete. Test fixtures do not enable production capabilities.
- ELD OAuth requires configured providers; signed-in driver mapping is required for personal HOS clocks. No legal drive-time estimate or HOS route planning is fabricated.
- POI, status, weather, 511 camera and road-event availability depends on approved backend/provider coverage. Errors and unknown data remain explicit.
- Offline display downloads require a configured public Mapbox token, SDK runtime, network and storage. On-device download/render validation is outstanding.

## E. Not implemented and why

- Native speech capture/hands-free support: no verified RN speech recognition integration; keyboard assistant retained.
- Destination-local ETA: approved timezone service absent; device-time ETA is explicitly labeled.
- Offline commercial routing/navigation: cached display tiles cannot supply it; CoPilot external gates remain.
- Synthetic current-leg distance, smooth simulated traveled geometry or arrival: omitted without authoritative live progress evidence. Display splitting uses only validated provider maneuver offsets.
- New brake-check/tollbooth/grade datasets, bundled weigh-station status, unsupported traffic/lane/audio toggles and artificial assistant answers: no approved current API evidence; no inert switches or invented records added.
- Junction photorealistic imagery: no provider image contract; real typed textual junction information can render.
- Billing, backend changes, legal ELD editing, production rollout, signing and device installation are outside scope.

## F. Safety review

- No passenger-routing fallback, fake guidance/lane/speed-limit data, or CoPilot bypass added.
- Backend/API tracked source unchanged; no production, database, Render, billing or signing changes.
- No real Trimble request, deployment, APK installation, commit or push.
- Changed source/test files scanned for credential/private-key patterns: none found. Public build configuration is read locally without printing its token and remains outside tracked task edits.
- test/failures/ was not read, modified, staged or deleted.

## G. Validation

- RN typecheck: PASS.
- RN lint with --max-warnings 0: PASS, zero errors/warnings.
- Full RN Jest suite: 362 passed, 0 failed, 26 suites.
- Existing native/static checks: PASS; explicitly not proof of native compilation or device verification.
- git diff --check: PASS.
- Android assembleRelease: PASS. BUILD SUCCESSFUL in 2m 15s; 288 actionable tasks (184 executed, 104 up-to-date). Full release assembly retained, including native compilation, Java/Kotlin, Metro/Hermes, release optimization and packaging. No Windows ACL changes.
- Final unsigned APK: ZIP 16 KB alignment PASS; all 34 packaged ELF libraries PASS via llvm-readelf and the repository page-size checker.
- APK signing: NOT PERFORMED; apksigner confirms no valid signature (expected unsigned output). Installation/device verification: NOT PERFORMED.
- Final integrity: all 36 tested source/test hashes match canonical and build-copy files; copied APK hash matches Gradle output; HEAD unchanged; no files staged.

### Local Android build environment

- Build-only copy: C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/rn-apk-build/app, temporarily mapped as Q:/app. Canonical source remains in backend-repair.
- Gradle 9.3.1, Java 17.0.18, Android platform 36, Build Tools 36.0.0 plus dependency-required 35.0.0, pinned NDK 27.1.12297006. No dependency/NDK downgrade.
- Isolated writable Gradle cache and Android preferences avoid global lock and C:/.android access failures.
- Removed only stale generated autolinking in the build copy; regeneration correctly targets Q:/app.
- Installed NDK LLVM tools returned Permission denied even for --version. Byte-identical copies of clang, clang++, ld.lld and llvm-readelf execute in the workspace. The unchanged pinned NDK was copied to Q:/ndk/27.1.12297006 and selected by build-copy-only local.properties. No ACL changes.
- Stopped only the isolated Q:/g Gradle daemon after moving the SDK to clear stale Java archive handles.
- The CPIK autolinking sourceDir expanded Q: into the physical workspace path; standalone Java could open/close the identical vendor JAR via Q: but failed toRealPath on the expanded path. Normalized only the generated build-copy autolinking JSON sourceDir back to Q:/app after checking both paths resolve to the same physical directory. Vendor files and canonical react-native.config.js remain unchanged.
- Java compilation subsequently encountered AccessDeniedException on the installed SDK android.jar/core-for-system-modules.jar. Unchanged platform 36, Build Tools 35/36 and CMake 3.22.1 were copied into Q:/sdk; build-copy-only local.properties and child-process environment select that SDK. Critical copied files have matching SHA-256 evidence.
- Release public API/display configuration is read from the existing local generated config without printing the token. No .env or signing changes.
- All 36 task source/test hashes match both the tested canonical files and build-copy files. Hash manifest and compiler-copy hashes are retained in rn-parity-validation.
- Metro required a consistent physical working directory: Node realpathSync did not expand the SUBST drive, whereas realpathSync.native did. A build-only Node wrapper and Gradle init script set the bundling subprocess working directory to that same physical source location. Gradle still runs its normal bundle/Hermes/source-map pipeline. Canonical Metro/Gradle config is unchanged.
- Command: gradlew.bat assembleRelease --stacktrace --offline --console=plain --init-script Q:/release-paths.init.gradle. The existing release settings remain unsigned, optimized and without a Metro server.
- Rebuild launcher outside Git: rn-parity-validation/build-short-release.cjs. Q: must remain mapped to rn-apk-build; its local SDK/NDK/caches are retained. The isolated Gradle daemon was stopped after completion.

### Exact release artifact

- APK: C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/artifacts/semitrax-rn-parity-20260916-release-unsigned.apk
- Size: 205571043 bytes (196.05 MiB).
- SHA-256: c42fdbbc74e786eea306278e2060521bd3bc6530425b404d1502826ee623683c
- Package: com.semitrax.app; versionName 0.1.0; versionCode 1; minSdk 24; targetSdk 36.
- Launch activity: com.semitrax.MainActivity. Release package has no application-debuggable flag.
- ABIs: arm64-v8a and x86_64; 17 libraries per ABI, 34 total.
- Every packaged .so was extracted from this exact APK and checked with llvm-readelf --program-headers --wide, plus scripts/check-android-page-size.cjs. All LOAD segments pass the 16 KB alignment checks. zipalign -c -P 16 -v 4 passes on the same APK.
- CoPilot/CPIK binaries are packaged and included in this audit; licensing/maps/runtime acceptance remains externally gated.
- Signature: UNSIGNED. apksigner verify returned DOES NOT VERIFY / Missing META-INF/MANIFEST.MF, consistent with the intentionally unsigned release configuration. This artifact must be signed with the existing approved key before installation.
- SAFE TO INSTALL NOW: NO (unsigned). DEVICE VERIFIED: NO. PRODUCTION READY: NO.
- Evidence: rn-parity-validation/final-apk-audit/audit.json, metadata.txt, zipalign.txt, per-library readelf output, final-apk-project-page-size.json, final-apk-signature.txt and final-integrity.json.

Packaged library names below occur once in each ABI:

- libappmodules.so
- libc++_shared.so
- libcopilot.so
- libdatastore_shared_counter.so
- libfbjni.so
- libhermestooling.so
- libhermesvm.so
- libimagepipeline.so
- libjsi.so
- libmapbox-common.so
- libmapbox-maps.so
- libnative-filters.so
- libnative-imagetranscoder.so
- libreact_codegen_rnscreens.so
- libreact_codegen_safeareacontext.so
- libreactnative.so
- librnscreens.so

## H. Classification

RN_PARITY_PHASE: implemented safe local parity work and release build PASS. Full product parity remains PARTIAL for the explicitly listed provider/platform gaps and external runtime/device acceptance; those capabilities are not represented as working. APK signing and device acceptance remain outstanding. This is not a production-ready declaration.

Build-cache reference: [Gradle dependency-cache reuse](https://docs.gradle.org/current/userguide/dependency_caching.html). Only regenerable local build state was copied; application dependencies were not upgraded.
