# SemiTraX controlled React Native migration

## Latest CoPilot preparation — 11 September 2026

The Android CPIK package is pinned to 10.28.2-497 and autolinked; React Native is aligned to the vendor's 0.85.0 baseline. Android service metadata, 16 KB build settings, ELF inspection and readiness tooling are added. All four shipped CoPilot ELF binaries pass alignment inspection; full application compliance and native runtime behavior remain unverified. iOS frameworks and real truck/navigation licensing are missing. No native CoPilot route or guidance start has been demonstrated.

See [the current integration audit](apps/mobile-react-native/COPILOT_INTEGRATION_AUDIT.md) for precise implementation status, API differences, restriction blockers and required device evidence. Flutter and backend source are preserved.

## Historical foundation pass

The record below describes the earlier foundation pass; its RN/toolchain versions and CoPilot dependency status are superseded by the update above.


Prepared 2026-09-11 against HEAD 68a37261f04ef94357dfb438df5aada0dbd6fd74 **plus the pre-existing uncommitted production-safety repairs**.

**Foundation pass implemented; migration is not complete and production parity is not verified.** Flutter remains the reference client. CoPilot is not implemented. No app has been registered, signed for production, published or deployed. The new candidate lives at apps/mobile-react-native after installation; it was developed and validated in the audit task's work/mobile-react-native directory to preserve the existing checkout.

## Outcome and architecture

Selected the standard React Native CLI/native-project layout: React Native 0.87.1, React 19.2.3, strict TypeScript, native-stack navigation and direct Android/iOS projects. This supports future vendor native integration without an Expo Go boundary. The checked-in package lock fixes the dependency graph used for validation.

UI → state/services → existing SemiTraX API → existing Trimble commercial routing remains the authority. Mapbox only displays routes and supplies public address geocoding. Secure credentials use platform Keychain/Keystore with serialized operations. Code-generated NativeSemiTraxPlatform connects Kotlin on Android and Objective-C++/Swift on iOS. NavigationEngine and native GuidanceBoundary are intentionally unavailable implementations.

React Native's documented [Swift adapter pattern](https://reactnative.dev/docs/the-new-architecture/turbo-modules-with-swift) informed the bridge. [Native event code generation](https://reactnative.dev/docs/the-new-architecture/native-modules-custom-events) supplies the location transport. The installed rnmapbox package's Android/iOS install files were checked alongside its [installation guide](https://rnmapbox.github.io/docs/install); the pinned 10.3.5 package says Android downloads no longer require a private download token. [Mapbox Geocoding v6](https://docs.mapbox.com/api/search/geocoding/) is used only for temporary in-memory address results.

## Preserved backend and P0 repairs

No backend, Prisma, Flutter source/test/asset, or existing native Flutter file is intentionally modified. Preservation hashes checked **426 existing files**; mismatches at preparation: **0**. The final preservation-verification.json records the installation check. Existing unrelated working-tree edits/deletions are preserved, including TomTom removal.

Preserved components include server.ts active routes, productionConfig.ts and its tests, trimbleProvider.ts and its tests, routingService.ts, route types, auth/truck/settings endpoints, HERE places, safety corridor endpoints, DOT/511 normalization, ELD OAuth foundations, billing schema/entitlement tests and every existing Flutter reference file.

Preserved protections: production database/JWT/CORS/public-HTTPS checks; Trimble credential isolation; commercial truck dimensions, pounds/feet, axle/trailer/hazmat/avoidance values; OverrideRestrict=false; actual maneuver geometry mapping; monotonic/bounded offsets with the backend's 250-meter confidence ceiling; one immutable ordered remaining-stop plan; explicit failure if the whole truck route fails; no passenger fallback; fail-closed guidance; release API URL rejection.

The client does not independently calculate legs. It sends one truck-route request containing live origin, every ordered remaining via stop and final destination. A failed add/remove/reorder/reroute leaves the prior accepted route and stop plan together. Intermediate-arrival consumption is implemented and tested, but only a future validated engine may trigger it during navigation.

## React Native inventory and migrated components

- App entry/configuration/session gate; native-stack home, planner, truck profiles, road/services and account/settings screens.
- Shared cards, fields, buttons and error states; navy/orange visual identity; original brand lockup, Android launcher images and iOS app icons reused byte-for-byte.
- Login, registration, current user, profile update, logout and token refresh. Transient failures retain sessions; rejected refresh signs out; late responses cannot resurrect a logged-out session.
- Complete commercial truck profile serialization/editor, default selection and service-level deletion. Unsupported values are not silently coerced. Delete UI is deferred.
- Authoritative truck routing, route preview, current GPS origin, destination search, add/remove/reorder stops and remaining-stop rerouting. Route totals and instructions are preview values, not simulated live guidance.
- Map display, route/stop/destination/POI markers, following, gestures/zoom, recenter, overview and day/night style. Source/bundle checked; device appearance and SDK behavior remain unverified.
- Independent precise location service with timestamp/accuracy/heading/speed, stale and invalid-fix rejection, ordered lifecycle operations, Kotlin LocationManager, iOS CoreLocation and explicit background boundaries.
- Real HERE-backed supported POI category requests; real safety corridor requests for restrictions, road events, cameras, parking, fuel and weigh stations. Read-only records show present provider fields, never invented availability or prices.
- Stored navigation preferences, including units, day/night and future voice/reroute options.
- Typed NavigationEngine commands/events and native Kotlin/Swift GuidanceBoundary classes. Start Navigation returns NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED even if a misconfigured native call unexpectedly resolves.
- Generic best-effort telemetry adapter retained as a dormant boundary; it is not activated or claimed as full analytics parity.

## Flutter-only and remaining work

The current UI is a coherent foundation, not complete visual/workflow parity. Remaining features include warning stacks and specialized road overlays, live next-maneuver/street/exit/distance/progress/ETA/arrival presentation, camera media, bundled weigh-station datasets, community reporting UI, time-zone arrival calculation, favorites, route alternatives/preferences beyond fastest, full map polish/accessibility/device checks, truck deletion UI, settings refresh when returning to an already-mounted planner, read-only subscription catalog and ELD connection/OAuth return flows.

Trips were an empty placeholder; local documents were text metadata rather than uploaded files; fleet/dispatch have inactive/missing modules and schema drift. These were not converted into fake production features. The disconnected Flutter offline downloader is not migrated as working map display. Neither offline truck routing nor offline commercial guidance is available. Firebase, product push notifications and deep links have no useful configured Flutter integration to carry forward.

The backend DOT ingest/stale-record lifecycle and feed coverage still need their existing defects/configuration addressed in a separate backend pass. Parking/weigh/fuel confidence, freshness and provider coverage are not certified by returning records. The supplemental record UI must not be treated as legal authority or complete national coverage.

## Validation

| Check | Result | Practical limit |
|---|---|---|
| Current backend production build + tests | PASS: 82 passed, 2 skipped, 84 total | Dedicated DB integration tests skipped; no production DB accessed. |
| Trimble provider tests | PASS within backend suite | Includes restrictions, ordered stops, mapping and low-confidence failures. No live vendor call. |
| Strict TypeScript | PASS | Includes application and unit-test source. |
| ESLint | PASS, zero warnings | Final npm run check log. |
| React Native unit tests | PASS: 50 tests, 5 suites | Environment/auth/profile/route/geometry/stops/reroute/failure/guidance/location coverage. |
| Android production-mode JavaScript bundle | PASS, 23 assets | Metro bundle only; not an APK or native compile. Initial bundle showed a dependency private-export warning. |
| Native Android/iOS bridge generation | PASS | Exact app module codegen and static wiring; not native compilation. |
| React Native autolinking configuration | PASS | Config JSON produced; SDK runtime not verified. |
| Release config without API URL | Correctly rejected, exit 1 | Same validator used by native release hooks and runtime. |
| Android assembleDebug / Gradle help | BLOCKED BY CONFIGURATION | Windows AccessDeniedException opening Gradle 9.4.1 gradle-core JAR, before app compilation; SDK platform/build-tools 37 also not installed. |
| iOS native build | BLOCKED BY CONFIGURATION | This Windows host cannot run Xcode/CocoaPods/signing. App-wide iOS generation hits Unix find incompatibility; isolated module generation passes. |
| Device, connected API, real GPS/foreground service, Keychain/Keystore, maps and vendor behavior | NOT VERIFIED | Requires approved backend, tokens and real Android/iOS devices. |
| Existing Flutter tests | Preserved, not rerun in this pass | Hash preservation does not replace runtime regression testing. |

Test logs, autolinking JSON, release rejection, Metro output, dependency audit and preservation hashes accompany the report. npm audit reports {"info":0,"low":0,"moderate":3,"high":15,"critical":0,"total":18}. Root advisories are image-size parser denial-of-service and decode-uri-component malformed-input denial-of-service. At inspection image-size latest was still 2.0.2 (affected); decode-uri-component 0.5.0 exists but upstream navigation constraints still select an affected version. No force upgrade or unreviewed transitive major override was applied. This is **BLOCKED BY VENDOR / dependency remediation** for production readiness, not a clean security audit. Sources: [image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [decode-uri-component advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).

## Android, iOS and external configuration

See apps/mobile-react-native/README.md for exact setup commands. Install Node/npm, compatible JDK, Android SDK 37/build-tools 37/NDK 27.1.12297006, and resolve the Windows Gradle file-access problem. On macOS install Xcode/CocoaPods and run the generated workspace. Run npm ci, set approved SEMITRAX_API_URL/MAPBOX_PUBLIC_TOKEN, npm run configure and npm run check.

Android production ID remains **com.semitrax.app**; debug uses **com.semitrax.app.migration.debug**. Existing Play/Firebase ownership is not provable from the repository and no authenticated console verification was available in this pass. Verify listing, signing certificates, upload key and next versionCode before any release. No registration/publication occurred. Android releases remain unsigned rather than using the template debug key.

The **proposed** iOS release bundle ID is **com.semitrax.app**, with **com.semitrax.app.migration.debug** for debug. Source wiring is prepared; external registration, Apple team, provisioning, entitlements/privacy and distribution are unverified. The version/code values remain foundation placeholders pending store verification.

Required external configuration: approved public HTTPS backend; public Mapbox map/geocoding token; server-only Trimble entitlement/key and HERE key; approved DOT feeds; dedicated test database; optional ELD OAuth and billing credentials if those features are enabled later; verified app-store identities/signing; and eventual official Trimble SDK package/license/offline assets. No server secret belongs in generated.ts. Firebase is not installed and must not receive placeholder credentials.

## Future CoPilot integration points and stop condition

- TypeScript: src/services/guidance/NavigationEngine.ts; src/native/navigation/NativeSemiTraxPlatform.ts; NativeGuidanceAdapter.ts; features/guidance/progress.ts; features/stops/StopPlan.ts.
- Android: nativebridge/GuidanceBoundary.kt, SemiTraxPlatformModule.kt, SemiTraxPackage.kt.
- iOS: GuidanceBoundary.swift, SemiTraxLocation.swift, SemiTraxPlatform.h/.mm, codegen module registration and Xcode source wiring.
- Exact SDK initialization, truck-profile mapping, route acceptance/compatibility, waypoints, event schema, thread/lifecycle rules, licensing, offline packages and platform support are **BLOCKED BY VENDOR** until official documentation is supplied.
- Live commercial guidance is **NOT IMPLEMENTED**. No guessed vendor imports or fake CoPilot classes were introduced. This pass stops here.

## Complete parity matrix

| Feature | Flutter status | React Native status | Backend status | Test status | Notes |
|---|---|---|---|---|---|
| Entry/auth gate | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Home/Map/Trips/Docs/More navigation | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Driver dashboard | PARTIAL | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Reusable UI/theme | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Warning cards/stacks | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| API client | WORKING | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Registration/login/logout | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Refresh/session restore | PARTIAL | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Secure tokens | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Password reset | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| User profile | PARTIAL | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Truck profiles | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Production backend safety | WORKING | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Trimble routing | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| No passenger fallback | WORKING | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Maneuver geometry repair | WORKING | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Ordered stop-plan model | WORKING | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Add Stop / remaining stops | PARTIAL | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Route preview / alternatives | PARTIAL | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Map display | WORKING | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Camera/follow/zoom/recenter | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| GPS/location | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| ETA/distance/progress | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Native commercial guidance | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| TomTom | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Guidance bridge/state | PARTIAL | PARTIAL (typed native boundary) | Routing preserved; guidance unavailable | Unavailable engine + bridge generation PASS | Kotlin/Swift reject activation; exact vendor SDK pending. |
| Rerouting | PARTIAL | WORKING (logic tests); device integration pending | Existing implementation preserved | 50 RN tests / 82 backend tests overall | Exact route and session contracts; no backend edits. |
| Arrival | PARTIAL | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Destination/address search | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Time-zone/ETA destination zone | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Commercial POIs/truck stops | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Walmart/restaurants samples | PLACEHOLDER | NOT IMPLEMENTED (intentionally deferred) | Broken/partial/placeholders retained unchanged | No false-parity test claim | Do not copy mock or disconnected behavior. |
| Rest areas/scales/repair/wash/hotel | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Weigh-station inventory | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Weigh-station status | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Parking availability | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Fuel prices | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| DOT/511 events/cameras | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| Traffic refresh | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Truck restrictions | PARTIAL | PARTIAL (source implemented; device/provider validation pending) | Existing Trimble/HERE/safety services reused | Typecheck/lint/bundle + targeted logic tests | No simulated progress or provider records; special overlays/media still incomplete. |
| OSM road features | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Offline downloaded maps | BROKEN | NOT IMPLEMENTED (intentionally deferred) | Broken/partial/placeholders retained unchanged | No false-parity test claim | Do not copy mock or disconnected behavior. |
| Offline truck routing/guidance | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Planned/recent/saved trips | PLACEHOLDER | NOT IMPLEMENTED (intentionally deferred) | Broken/partial/placeholders retained unchanged | No false-parity test claim | Do not copy mock or disconnected behavior. |
| Favorites | BACKEND-ONLY | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Documents | PARTIAL | NOT IMPLEMENTED (intentionally deferred) | Broken/partial/placeholders retained unchanged | No false-parity test claim | Do not copy mock or disconnected behavior. |
| Subscription catalog | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Store/Stripe purchases and restore | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Entitlements/pilot/fleet billing schema | BACKEND-ONLY | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Fleet/dispatch/loads | BROKEN | NOT IMPLEMENTED (intentionally deferred) | Broken/partial/placeholders retained unchanged | No false-parity test claim | Do not copy mock or disconnected behavior. |
| ELD | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Settings | WORKING | PARTIAL (source implemented; end-to-end parity unverified) | Existing contracts preserved | Typecheck/lint/bundle; relevant unit tests | Real authenticated flows require approved test backend and devices. |
| Notifications | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Firebase | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Analytics | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Crash reporting | PARTIAL | NOT IMPLEMENTED in UI; boundary documented | Existing APIs/assets preserved | Source audit only | Flutter/reference or backend capability remains; dedicated parity work required. |
| Deep links | NOT IMPLEMENTED | NOT IMPLEMENTED | Preserved as inventoried | Unavailable-engine tests where applicable | CoPilot, app links and external registrations are not added. |
| Android identity/build | PARTIAL | PARTIAL / BLOCKED BY CONFIGURATION | Not applicable | Codegen/static PASS; build BLOCKED | Windows Gradle JAR denied; SDK 37 missing; no external ownership verification. |
| iOS identity/build | PARTIAL | PARTIAL / BLOCKED BY CONFIGURATION | Not applicable | Module codegen/static PASS; no Xcode build | Proposed com.semitrax.app; Apple ownership/signing unverified. |
| Flutter tests | WORKING | Not applicable | Not applicable | Files preserved; Flutter suite not rerun | This pass adds RN tests and reruns backend tests. |
| Backend tests | WORKING | Not applicable | WORKING: 82 passed, 2 skipped | Current repaired test suite | Dedicated database integration environment still needed. |

## Complete Flutter inventory


Recorded 2026-09-11 **before creating React Native code**. Repository: `C:\Users\duken\Documents\Codex\2026-09-03\semitrack-navigation-reimplementation\work\semitrack`, HEAD `68a37261f04ef94357dfb438df5aada0dbd6fd74` plus the existing uncommitted production-safety repairs. Those working-tree repairs are the baseline, not the older committed TomTom implementation. No Flutter removal is authorized.

WORKING means implemented in source, not a vendor/device certification. PARTIAL means useful implementation with integration/parity work outstanding. PLACEHOLDER means presentation/sample/scaffold without its promised behavior. BROKEN identifies a concrete defect. BACKEND-ONLY identifies a server capability without a working client flow. NOT IMPLEMENTED means no active implementation. Provider credentials, account ownership, live database state and road behavior cannot be established from source alone.

| Feature | Flutter status | Evidence (repository-relative file:line) | Migration disposition |
|---|---|---|---|
| Entry/auth gate | WORKING | `lib/main.dart:13`, `:67` | Port startup and explicit session states. |
| Home/Map/Trips/Docs/More navigation | WORKING | `lib/screens/app_shell.dart:21`, `:29`, `:52` | Preserve app shell, avoid recreating map on tab changes. |
| Driver dashboard | PARTIAL | `lib/screens/driver_dashboard_screen.dart:1` | Preserve design and actual account data, not implied live metrics. |
| Reusable UI/theme | WORKING | `lib/theme/semitrack_theme.dart:3`, `lib/widgets/semitrack_ui.dart:1` | Port navy/orange identity, cards, fields and empty states. |
| Warning cards/stacks | PARTIAL | `lib/widgets/warning_popup_card.dart:1`, `lib/widgets/warning_popup_stack.dart:1`, `lib/services/warning_manager.dart:1` | Preserve real data provenance; provider coverage unverified. |
| API client | WORKING | `lib/core/api_client.dart:8`, `:47` | Preserve HTTPS release guard and API paths. Strengthen malformed/private-host validation. |
| Registration/login/logout | WORKING | `lib/services/auth_service.dart:121`, `:126`, `:170`; `apps/api/src/server.ts:161`, `:171`, `:193` | Reuse server, secure token storage. |
| Refresh/session restore | PARTIAL | `lib/services/auth_service.dart:98`, `lib/core/api_client.dart:233` | Avoid deleting valid tokens on transient network/server failures. |
| Secure tokens | WORKING | `lib/services/auth_service.dart:53`, `:84` | Platform Keychain/Keystore; no ordinary local-storage tokens. |
| Password reset | PARTIAL | `apps/api/src/server.ts:209`–`:239` | Request/confirmation API exists; email delivery absent. Show this limitation honestly. |
| User profile | PARTIAL | `apps/api/src/server.ts:242`, `:248`, `lib/screens/profile_screen.dart:10` | Port current user read/update. |
| Truck profiles | WORKING | `lib/models/truck_profile.dart:1`, `:71`; `lib/services/truck_profile_service.dart:17`, `:37` | Preserve dimensions, pounds/feet, axle/trailer/hazmat and every avoidance field. |
| Production backend safety | WORKING | `apps/api/src/config/productionConfig.ts:22` | Preserve without edits; rerun existing tests. |
| Trimble routing | WORKING | `apps/api/src/services/providers/trimbleProvider.ts:101`, `:171` | Reuse backend PC*Miler/RoutePath; `OverrideRestrict=false`. Live entitlement still external. |
| No passenger fallback | WORKING | `apps/api/src/services/routingService.ts:73`; `lib/screens/truck_map_screen.dart:8051` | New client uses only `/routing/truck-route` and accepts Trimble truck-safe responses. |
| Maneuver geometry repair | WORKING | `apps/api/src/services/providers/trimbleProvider.ts:370`; `apps/api/src/types.ts:39`; `lib/screens/truck_map_screen.dart:8002` | Consume actual offset/coordinate/confidence. Never use maneuver ordinal as geometry index. |
| Ordered stop-plan model | WORKING | `lib/services/authoritative_stop_plan.dart:14` | Port add/remove/reorder/ordered intermediate-arrival semantics. |
| Add Stop / remaining stops | PARTIAL | `lib/screens/truck_map_screen.dart:20657`, `:20695`, `:7155` | Preserve repaired authoritative plan, make route/plan updates transactional and failure explicit. |
| Route preview / alternatives | PARTIAL | `lib/screens/truck_map_screen.dart:10340`; `apps/api/src/services/providers/trimbleProvider.ts:421` | Preview authoritative routes; reject alternatives without mapped maneuvers. |
| Map display | WORKING | `lib/screens/truck_map_screen.dart:17942`; `pubspec.yaml:17` | Mapbox display adapter, no routing credentials or passenger routing. |
| Camera/follow/zoom/recenter | PARTIAL | `lib/screens/truck_map_screen.dart:4456`–`:4926` | Port explicit camera modes; device visual validation required. |
| GPS/location | PARTIAL | `lib/services/native_navigation_service.dart:1`; Android `navigation/NavigationForegroundService.kt:23`; `ios/Runner/NativeNavigationModule.swift:5` | Provider-independent native tracking with foreground/background permission lifecycle. |
| ETA/distance/progress | PARTIAL | `lib/models/route_progress.dart:1`; `lib/screens/truck_map_screen.dart:6715` | Preserve route totals; only show guidance progress from an actual engine. |
| Native commercial guidance | NOT IMPLEMENTED | `android/app/src/main/kotlin/com/example/semitrack_mobile/navigation/NativeGuidanceEngine.kt:1`; `ios/Runner/NativeNavigationModule.swift:111` | Explicit unavailable engine; no CoPilot implementation in this pass. |
| TomTom | NOT IMPLEMENTED | Working-tree deletions of `TomTomGuidanceEngine.kt` and `TomTomSdkManager.kt`; current `android/app/build.gradle:88` | Removal already completed. Do not resurrect. |
| Guidance bridge/state | PARTIAL | `lib/models/navigation_state.dart:1`; Android `navigation/NavigationChannelHandler.kt:18` | Port typed engine/events; future Kotlin and Swift CoPilot boundaries. |
| Rerouting | PARTIAL | `lib/services/latest_request_coordinator.dart:1`; `lib/screens/truck_map_screen.dart:10359` | Preserve current route on failure, reject stale requests and retain all remaining stops. |
| Arrival | PARTIAL | `lib/screens/truck_map_screen.dart:6793`; `lib/services/authoritative_stop_plan.dart:60` | No simulated production arrivals; engine events + explicit ordered completion contract. |
| Destination/address search | PARTIAL | `apps/api/src/server.ts:394`; `lib/services/here_places_service.dart:1` | HERE-backed server search requires HERE key. No fake results. |
| Time-zone/ETA destination zone | PARTIAL | `lib/services/destination_time_zone_service.dart:1`; `apps/api/src/server.ts:377` | Server time-zone API exists; preserve boundary. |
| Commercial POIs/truck stops | PARTIAL | `lib/services/poi_service.dart:107`–`:228`; `lib/services/here_places_service.dart:1` | Use verified bundled records and actual backend place results. |
| Walmart/restaurants samples | PLACEHOLDER | `lib/services/poi_service.dart:201`–`:209`; `assets/restaurants.json` | Already excluded from active loader; do not migrate sample datasets as live data. |
| Rest areas/scales/repair/wash/hotel | PARTIAL | `lib/services/poi_service.dart:41`; backend place categories in `apps/api/src/server.ts:394` | Supported categories only; empty/unavailable state for missing coverage. |
| Weigh-station inventory | PARTIAL | `lib/services/weigh_station_repository.dart:13`; `assets/data/weigh_stations/us_weigh_stations_manifest.json:1` | Versioned bundled locations, optional remote loader not connected by default. |
| Weigh-station status | PARTIAL | `apps/api/src/modules/safety/safety.routes.ts:148`, `:277`; `lib/services/weigh_station_service.dart:1` | Real DB/community aggregation; no evidence of a configured nationwide official live feed. |
| Parking availability | PARTIAL | `apps/api/src/modules/safety/safety.routes.ts:196`; `lib/services/live_road_data_service.dart:90` | Preserve provenance, TTL/unknown states. |
| Fuel prices | PARTIAL | `apps/api/src/modules/safety/safety.routes.ts:218`, `:324` | Reads observations; community reports do not automatically become observations. No live commercial feed configured in source. |
| DOT/511 events/cameras | PARTIAL | `apps/api/src/services/providers/dot511Provider.ts:103`; `apps/api/src/services/dotFeedService.ts:9` | Preserve backend normalization. Feed config/coverage and stale-record lifecycle remain blockers. |
| Traffic refresh | PARTIAL | `lib/services/live_road_data_service.dart:9`; map `_refreshLiveRoadData` | Snapshot overlays exist; continuous traffic-aware guidance not established. |
| Truck restrictions | PARTIAL | `apps/api/src/modules/safety/safety.routes.ts:122`; Trimble `:171` | Truck route enforcement retained; supplemental DB coverage unverified. |
| OSM road features | PARTIAL | `apps/api/src/services/roadFeatureService.ts:1`; safety routes `:32` | Context only, never authoritative truck restrictions. |
| Offline downloaded maps | BROKEN | `lib/services/offline_map_service.dart:87`–`:109`; map uses `FlutterMap`/HTTP `TileLayer` | Native Mapbox tile store is not used by visible Flutter map. Do not port this disconnected download UI. |
| Offline truck routing/guidance | NOT IMPLEMENTED | Offline metadata says `offline-map-only` (`:109`); native guidance unavailable | Defer until official CoPilot capabilities and licensing. |
| Planned/recent/saved trips | PLACEHOLDER | `lib/screens/trips_screen.dart:104` | Always-empty UI; no working trip history flow to claim as migrated. |
| Favorites | BACKEND-ONLY | `apps/api/src/server.ts:431`–`:438` | Preserve backend; client parity can be added explicitly. |
| Documents | PARTIAL | `lib/screens/documents_screen.dart:17`, `:67`; `apps/api/src/modules/documents/document.routes.ts:11` | Local text records only, not document upload. Inactive upload module is broken; do not migrate as working cloud documents. |
| Subscription catalog | PARTIAL | `lib/services/subscription_plan_service.dart:19`; `lib/screens/subscription_plans_screen.dart:32` | Read-only catalog when billing enabled. Selection does not purchase. |
| Store/Stripe purchases and restore | NOT IMPLEMENTED | `apps/api/src/server.ts:841`; `pubspec.yaml:9` | No fake paywall success or receipts. |
| Entitlements/pilot/fleet billing schema | BACKEND-ONLY | `apps/api/src/modules/billing/entitlement.middleware.ts:5`; Prisma `:732` | Preserve tests/schema. Routing middleware not entitlement-gated; no new billing policy in mobile. |
| Fleet/dispatch/loads | BROKEN | `apps/api/src/modules/dispatch/dispatch.routes.ts:4`; inactive load modules; server mounts `:831` | Not mounted; missing dispatch service, schema drift. Do not represent as live fleet functionality. |
| ELD | PARTIAL | `lib/services/eld_service.dart:64`; `apps/api/src/server.ts:483`, `:562`, `:599` | Real OAuth/sync foundations; credentials, driver association, freshness and callback return need validation. |
| Settings | WORKING | `lib/models/nav_settings_model.dart:1`; `lib/screens/nav_settings_screen.dart:13`; server `:334` | Port supported preferences and preserve unknown server settings. |
| Notifications | NOT IMPLEMENTED | inactive `apps/api/src/modules/notifications/notification.service.ts:9`; missing Prisma notification model | Android GPS foreground notification exists, product push/inbox does not. |
| Firebase | NOT IMPLEMENTED | No Firebase dependencies in `pubspec.yaml`; no active imports in `lib/main.dart:1`; README `:7` is stale | No useful live integration to port. No placeholder credentials. External setup only if later needed. |
| Analytics | PARTIAL | `lib/services/analytics_service.dart:24`, `:47`, `:115`; server `:832` | Real best-effort API telemetry; preserve actual events, no simulated sessions. |
| Crash reporting | PARTIAL | `lib/core/app_error_guard.dart:1` | Error guards exist; no remote crash vendor SDK. |
| Deep links | NOT IMPLEMENTED | Android manifest launcher filter `:36`; no iOS URL schemes | OAuth callback currently JSON response; no verified app/universal-link registration. |
| Android identity/build | PARTIAL | `android/app/build.gradle:15`, `:47`, `:72` | Preserve `com.semitrax.app`, debug suffix. Play/Firebase ownership not verifiable from local files. |
| iOS identity/build | PARTIAL | `ios/Runner.xcodeproj/project.pbxproj:277`, `:400`, `:422` | Old `com.example.semitrackMobile`; propose branded identity, no external registration. |
| Flutter tests | WORKING | `test/*_test.dart`, including API-release/stop-plan/native-removal tests | Preserve all files; regression execution to be reported separately. |
| Backend tests | WORKING | `apps/api/test/*`, including production configuration and Trimble mapping tests | Run current repaired baseline, not earlier audit copy. DB integration needs dedicated test DB. |

All 12 screen files: `active_navigation_menu_screen.dart`, `app_shell.dart`, `auth_screen.dart`, `documents_screen.dart`, `driver_dashboard_screen.dart`, `eld_connections_screen.dart`, `nav_settings_screen.dart`, `offline_maps_screen.dart`, `profile_screen.dart`, `subscription_plans_screen.dart`, `trips_screen.dart`, `truck_map_screen.dart` (app-shell/menu included). Exact machine inventory and preservation hashes will accompany the final report. The original source paths remain the authoritative references.

Migration implementation has not begun at this baseline. Final React Native/backend/test columns will be maintained in `REACT_NATIVE_MIGRATION.md`. This inventory supersedes earlier observations about missing P0 fixes and active TomTom.


## Files and git scope

Only new apps/mobile-react-native files, new REACT_NATIVE_MIGRATION.md and a narrow root .gitignore addition belong to this pass. No commit is created. Files below are created, including reused asset copies; generated files, dependency/build caches and local configuration are excluded from the handoff. The complete SHA-256/size manifest accompanies the report.

- REACT_NATIVE_MIGRATION.md
- apps/mobile-react-native/.bundle/config
- apps/mobile-react-native/.env.example
- apps/mobile-react-native/.eslintrc.js
- apps/mobile-react-native/.gitignore
- apps/mobile-react-native/.prettierrc.js
- apps/mobile-react-native/.watchmanconfig
- apps/mobile-react-native/App.tsx
- apps/mobile-react-native/FEATURE_BOUNDARIES.md
- apps/mobile-react-native/Gemfile
- apps/mobile-react-native/README.md
- apps/mobile-react-native/__tests__/auth.test.ts
- apps/mobile-react-native/__tests__/environment.test.ts
- apps/mobile-react-native/__tests__/fixtures.ts
- apps/mobile-react-native/__tests__/guidance.test.ts
- apps/mobile-react-native/__tests__/location.test.ts
- apps/mobile-react-native/__tests__/routing.test.ts
- apps/mobile-react-native/android/app/build.gradle
- apps/mobile-react-native/android/app/proguard-rules.pro
- apps/mobile-react-native/android/app/src/main/AndroidManifest.xml
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/MainActivity.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/MainApplication.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/GuidanceBoundary.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/LocationEvents.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/LocationForegroundService.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/SemiTraxPackage.kt
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/SemiTraxPlatformModule.kt
- apps/mobile-react-native/android/app/src/main/res/drawable/rn_edit_text_material.xml
- apps/mobile-react-native/android/app/src/main/res/mipmap-hdpi/ic_launcher.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-mdpi/ic_launcher.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
- apps/mobile-react-native/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
- apps/mobile-react-native/android/app/src/main/res/values/strings.xml
- apps/mobile-react-native/android/app/src/main/res/values/styles.xml
- apps/mobile-react-native/android/build.gradle
- apps/mobile-react-native/android/gradle.properties
- apps/mobile-react-native/android/gradle/wrapper/gradle-wrapper.jar
- apps/mobile-react-native/android/gradle/wrapper/gradle-wrapper.properties
- apps/mobile-react-native/android/gradlew
- apps/mobile-react-native/android/gradlew.bat
- apps/mobile-react-native/android/settings.gradle
- apps/mobile-react-native/app.json
- apps/mobile-react-native/babel.config.js
- apps/mobile-react-native/index.js
- apps/mobile-react-native/ios/.xcode.env
- apps/mobile-react-native/ios/Podfile
- apps/mobile-react-native/ios/SemiTrax.xcodeproj/project.pbxproj
- apps/mobile-react-native/ios/SemiTrax.xcodeproj/xcshareddata/xcschemes/SemiTrax.xcscheme
- apps/mobile-react-native/ios/SemiTrax/AppDelegate.swift
- apps/mobile-react-native/ios/SemiTrax/GuidanceBoundary.swift
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Contents.json
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-20x20@1x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-20x20@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-20x20@3x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-29x29@1x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-29x29@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-29x29@3x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-40x40@1x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-40x40@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-40x40@3x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-60x60@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-60x60@3x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-76x76@1x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-76x76@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/AppIcon.appiconset/Icon-App-83.5x83.5@2x.png
- apps/mobile-react-native/ios/SemiTrax/Images.xcassets/Contents.json
- apps/mobile-react-native/ios/SemiTrax/Info.plist
- apps/mobile-react-native/ios/SemiTrax/LaunchScreen.storyboard
- apps/mobile-react-native/ios/SemiTrax/PrivacyInfo.xcprivacy
- apps/mobile-react-native/ios/SemiTrax/SemiTrax-Bridging-Header.h
- apps/mobile-react-native/ios/SemiTrax/SemiTraxLocation.swift
- apps/mobile-react-native/ios/SemiTrax/SemiTraxPlatform.h
- apps/mobile-react-native/ios/SemiTrax/SemiTraxPlatform.mm
- apps/mobile-react-native/jest.config.js
- apps/mobile-react-native/metro.config.js
- apps/mobile-react-native/package-lock.json
- apps/mobile-react-native/package.json
- apps/mobile-react-native/scripts/check-native.cjs
- apps/mobile-react-native/scripts/configure.mts
- apps/mobile-react-native/src/app/AppRoot.tsx
- apps/mobile-react-native/src/app/services.ts
- apps/mobile-react-native/src/assets/semitrax_brand_lockup.png
- apps/mobile-react-native/src/components/Brand.tsx
- apps/mobile-react-native/src/components/ui.tsx
- apps/mobile-react-native/src/config/environment.ts
- apps/mobile-react-native/src/features/auth/AuthStore.ts
- apps/mobile-react-native/src/features/dot511/CorridorRecords.tsx
- apps/mobile-react-native/src/features/guidance/progress.ts
- apps/mobile-react-native/src/features/map/TruckMap.tsx
- apps/mobile-react-native/src/features/poi/PoiService.ts
- apps/mobile-react-native/src/features/routing/RoutePreview.tsx
- apps/mobile-react-native/src/features/routing/RouteStore.ts
- apps/mobile-react-native/src/features/search/SearchService.ts
- apps/mobile-react-native/src/features/settings/SettingsService.ts
- apps/mobile-react-native/src/features/stops/StopPlan.ts
- apps/mobile-react-native/src/features/truckProfile/TruckProfileStore.ts
- apps/mobile-react-native/src/hooks/useStore.ts
- apps/mobile-react-native/src/models/contracts.ts
- apps/mobile-react-native/src/native/navigation/NativeGuidanceAdapter.ts
- apps/mobile-react-native/src/native/navigation/NativeLocationProvider.ts
- apps/mobile-react-native/src/native/navigation/NativeSemiTraxPlatform.ts
- apps/mobile-react-native/src/navigation/AppNavigator.tsx
- apps/mobile-react-native/src/screens/AuthScreen.tsx
- apps/mobile-react-native/src/screens/PlanningScreen.tsx
- apps/mobile-react-native/src/screens/ServicesScreen.tsx
- apps/mobile-react-native/src/screens/SettingsScreen.tsx
- apps/mobile-react-native/src/screens/TruckProfileScreen.tsx
- apps/mobile-react-native/src/services/api/ApiClient.ts
- apps/mobile-react-native/src/services/guidance/NavigationEngine.ts
- apps/mobile-react-native/src/services/location/LocationService.ts
- apps/mobile-react-native/src/services/routing/TruckRoutingService.ts
- apps/mobile-react-native/src/services/storage/SecureTokenVault.ts
- apps/mobile-react-native/src/services/storage/SerializedTokenVault.ts
- apps/mobile-react-native/src/services/storage/TokenVault.ts
- apps/mobile-react-native/src/services/telemetry/Telemetry.ts
- apps/mobile-react-native/src/state/Store.ts
- apps/mobile-react-native/tsconfig.json

Modified existing file: .gitignore only. Newly generated src/config/generated.ts is a local ignored artifact recreated by npm ci/configure, not a secret-bearing checked-in file. Deleted source files: none. The scaffold debug.keystore was removed before delivery; all existing Flutter files remain.

The supplied git diff --stat log describes the entire pre-existing working tree, because new untracked files are not counted by ordinary git diff. A separate migration-only additions stat/manifest is provided, without staging unrelated work. Final installation status and exact diff statistics are recorded in MIGRATION_HANDOFF.md.

**No passenger-car fallback was introduced. No real credentials, private tokens, signing files or secrets are included. No commit, publication or deployment was performed. Flutter is not deleted. CoPilot is not implemented.**

## Verified installation result

Installed into the original repository at apps/mobile-react-native: 123 new app files and REACT_NATIVE_MIGRATION.md; .gitignore is the sole existing file modified by this pass. All 123 installed app SHA-256 hashes match the tested candidate. All 426 preservation-baseline files still match. The new-file credential-signature scan has zero findings and the five tested private/build paths are ignored. XML resource validation passed and every referenced iOS app icon exists.

Current ordinary git diff --stat (includes pre-existing repairs; untracked migration additions are excluded by Git):

```text
 .github/workflows/build_apk.yml                    |  25 ++-
 .gitignore                                         |   9 +
 IMPLEMENTATION_NOTES.md                            |   2 +-
 README.md                                          |  32 ++-
 analysis_options.yaml                              |   2 +-
 android/app/build.gradle                           |  39 ++--
 .../com/example/semitrack_mobile/MainActivity.kt   |  12 +-
 .../navigation/GuidanceSafetyPolicy.kt             |  22 +-
 .../navigation/NativeGuidanceEngine.kt             |   7 +-
 .../navigation/NavigationChannelHandler.kt         |  10 +-
 .../navigation/NavigationEventEmitter.kt           |   2 +-
 .../navigation/NavigationForegroundService.kt      |   6 +-
 .../navigation/NavigationModels.kt                 |   2 +-
 .../navigation/SemiTrackNavigationManager.kt       |   4 +-
 .../navigation/TomTomGuidanceEngine.kt             | 221 ---------------------
 .../navigation/TomTomSdkManager.kt                 |  77 -------
 .../navigation/TruckProfileMapper.kt               |   2 +-
 .../navigation/GuidanceSafetyPolicyTest.kt         |  30 +--
 android/settings.gradle                            |  24 +--
 apps/api/.env.example                              |   8 +-
 apps/api/src/config/env.ts                         |   6 +-
 apps/api/src/services/providers/trimbleProvider.ts |  79 +++++++-
 apps/api/src/types.ts                              |   2 +
 apps/api/test/trimbleProvider.test.ts              |  54 +++++
 lib/core/api_client.dart                           |  26 ++-
 lib/screens/truck_map_screen.dart                  | 128 +++++++++---
 26 files changed, 370 insertions(+), 461 deletions(-)
```

The migration-only no-index diff includes 125 files: 123 new app files, one new migration document and one modified .gitignore. It is supplied separately as migration-only-diff-stat.txt; migration-review.diff is a review artifact with task-directory prefixes, not a ready-to-apply production patch. The ZIP contains the app/document and reviewed root .gitignore, without node_modules, local environment, build products or signing files.
