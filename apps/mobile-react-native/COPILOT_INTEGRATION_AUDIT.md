# CoPilot integration audit — 11 September 2026

The subsequent [P0 report](COPILOT_P0_REPORT.md) contains the isolated native-build
failure, exact provisioning requirements, exhaustive field mapping, new fail-closed
guards and first-session status. Its source inspection corrects the vehicle enum
used below to `TRUCK_HEAVY_DUTY`.

**Status: native preparation only. No real CoPilot route has been calculated and
turn-by-turn navigation has not started.** Flutter and the existing Trimble HTTP
routing backend remain in place. No passenger routing, simulated guidance,
fake licensing or timer-driven navigation events have been introduced.

## Selected delivery and platform setup

Started with Trimble's [Platform Setup Guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/),
then inspected the current API Functions, JSON Objects, Native Module Constants,
and Hooks/Callbacks documentation against the published Android Java bridge.

The pinned npm package is `trimble-maps-cpik-react-native-library@10.28.2-497`.
Its bundled version resources identify CoPilot `10.28.2.497`. It includes the
Android bridge sources, `copilot.jar`, `cpik.jar`, `vocalizerlib.jar`, assets and
four ABI copies of `libcopilot.so`. Its declared JS entry point is absent. It has
no iOS frameworks or podspec. Use its native modules, not a JS import of the
package. Public download availability does not establish commercial entitlement.

Both the [Android guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/android-guide/)
and vendor Gradle dependency target RN 0.85. The app and RN tooling are now pinned
to 0.85.0, using the official RN 0.85.0 native template's SDK 36, Build Tools
36.0.0, Kotlin 2.1.20, Gradle 9.3.1 and NDK 27.1.12297006. React remains 19.2.3.
This removes the earlier RN 0.87 mismatch; runtime compatibility is still unverified.

Android has an explicit `CPIKPackagesHolder` autolink registration, CoPilot's
non-exported location service, internal-storage/custom-view metadata, relevant
permissions, and conservative vendor JNI/reflection keep rules. It does not bind
the service or activate licenses. Contacts, shared external storage, billing and
device-ID permissions from legacy examples were not added for this core flow.

The [iOS guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/ios-guide/)
requires separately delivered CoPilotIntegrationKit and CPIKReactNative frameworks
plus resources. These are missing. `ios/COPILOT_SETUP.md` records exact prerequisites;
`npm run copilot:check` can inventory the supplied directory without reading secrets.
No iOS SDK linking or startup is implemented. Windows cannot perform Xcode/device validation.

## Android 16 KB evidence

Trimble's [16 KB notice](https://developer.trimblemaps.com/copilot-navigation/release-notes/copilot-16kb/)
requires embedded CPIK 10.28.2.386 or later. Selected 10.28.2.497 exceeds that floor.
The actual arm64-v8a, armeabi-v7a, x86 and x86_64 `libcopilot.so` files all passed
the ELF PT_LOAD alignment/congruence check. SHA-256 hashes and segment evidence
are recorded in the handoff's `copilot-elf-alignment.json`.

`npm run check:page-size -- <directory>` scans all real `.so` files under a supplied
extracted directory, fails on empty/bad input, and explicitly reports application
compliance as unverified. Tooling tests cover ELF32/ELF64, byte order, insufficient
alignment, invalid addresses and malformed headers. Synthetic ELF test fixtures
exercise the parser; they do not simulate CoPilot behavior.

The app enables NDK r27 flexible page sizes and uncompressed native packaging.
Those settings cannot repair third-party prebuilt binaries. Following
[Android's page-size guide](https://developer.android.com/guide/practices/page-sizes),
the release gate still requires:

1. Build the final release AAB and generated APKs. Extract **every** packaged native
   library and run the ELF audit, including React Native, Hermes, Mapbox, screens,
   app/codegen libraries, libc++ and transitive/vendor dependencies.
2. Verify AAB `PAGE_ALIGNMENT_16K` with `bundletool dump config --bundle=<aab>`;
   verify each delivered APK with `zipalign -c -P 16 -v 4 <apk>`.
3. On a device/emulator where `adb shell getconf PAGE_SIZE` returns `16384`, install
   and exercise startup, maps, GPS, truck routing, guidance, voice and lifecycle.

**Whole-application compliance is not established.** Only the four vendor ELF
files have binary-level evidence. A version comparison or build flag is not certification.

## Audited integration contracts

The source inventory accompanying this report records 91 bridge source modules,
174 React methods and 98 distinct emitted event names. It is source inspection,
not proof of device behavior. Runtime enum values must come from native constants.

| Area | Actual contract and implementation consequence |
| --- | --- |
| Startup | Android `CopilotStartupMgr.bindCoPilotService()`; iOS guide uses `Copilot.startNavApp()`. Register listeners before startup. `onCPStartup` alone does not prove licensing, map readiness, or a navigable route. |
| Licensing | `LicenseListener.setAMSLoginInfo(assetID, companyID)` is void in this Android package. Its three-identifier method is `setAMSLoginInfoWithExternalAccount(assetID, externalAccountID, partnerID)`, unlike the guide's overload example. `LicenseMgr.isLicensingReady()` and `getFeatureStatus(feature)` are distinct from startup. |
| Truck license | Resolve `LicenseFeature.FULL_NAVIGATION`, `TRUCK_HEAVY_DUTY` and applicable regional entitlements with native `FeatureStatus` values. Do not equate API-key presence, startup success or a downloaded package with licensed truck guidance. |
| Profiles | `VehicleRoutingProfile.createNewProfile(name, VehicleType.TRUCK_HEAVY_DUTY)` obtains real native defaults. Apply via `RouteMgr.setActiveVehicleRoutingProfile(profile)`, then read back all safety fields. A setter's acknowledgement cannot prove preservation. The P0 follow-up corrected the earlier `TRUCK` reference: that constant is not exported by this package. |
| Routes/stops | `isCopilotReadyToAddStops()`, `addStops(purpose, stopArray, previewMode)`, then `calculateRoute()`. The calculation method acknowledges submission; completion/failure arrives asynchronously. `getRouteLegs(ignoreWaypoints)` requires the Boolean in this package. |
| Guidance | CoPilotView is a real native view and must be rendered only after startup. `GuidanceMgr.getRouteCoordinates(...)` describes CoPilot's route. The backend preview polyline is not proof that CoPilot is following the same route. No generic vendor `startNavigation(route)` method was invented. |
| Voice | `SpeechMgr.getLanguages()`, `getCurrentVoice()`, `setLanguageAndVoice(language,country,voiceName)`, `setMuteState(boolean)` and `setVolume(gain)` are available. Voice downloads/language availability require real SDK/map/licensing validation. |

References: [CoPilotMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/copilotmgr/),
[LicenseMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/licensemgr/),
[RouteMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/routemgr/),
[GuidanceMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/guidancemgr/),
[SpeechMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/speechmgr/),
[Native Module Constants](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/native-module-constants/).

### Truck profile parity

The [JSON object contract](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/json-objects/)
and shipped `VehicleDimensionsRNModel` use inches for length/width/height and
pounds for `totalWeight`/`weightPerAxle`. Source resolves a documentation example
that uses `weight` inconsistently. Future mapping must round dimensions upward,
use a reviewed loaded/gross-weight policy and verify the active profile.

The inspected bridge exposes one `hazmatType`, not SemiTraX's multiple hazardous
goods array. It exposes no direct axle-count, trailer-count/type, avoid-highways,
avoid-residential or avoid-dirt-roads profile fields. `ferriesDiscouraged` and
`tollRoads` preferences must not be claimed as strict prohibitions without
confirmation. Obtain a supported Trimble mapping or native extension for every
required restriction. Do not choose the first hazmat class, discard fields,
reuse a passenger default or claim that a partial mapping is truck-safe.

### Callbacks and state ownership

The [callback documentation](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/hooks-and-callbacks/)
and Android source expose calculation start/complete/failure, stop changes,
turn instructions, ETA, travel time, distance, position, `onOutOfRoute`,
`onRejoinRoute` and arrival. Deviations use ISO timestamp strings in this bridge.
No literal `onOffRoute` event should be subscribed to.

`onArrivedAtStop` in this package supplies `isFinalStop` and `stop`, omitting the
documented `arrivalStatus`. Arrival semantics must be device-confirmed before
completing stops. Distance units need verification; no guessed meter conversion.
Route callbacks lack SemiTraX request IDs: serialize native route mutations and
reject stale-session events. Route/guidance listeners unregister on host pause,
so background JS callbacks are not assured. Validate lifecycle and rerouting
against the licensed SDK; never infer a completed route from an acknowledgement.

SemiTraX's StopPlan/RouteStore retain stop IDs, ordering and intermediate/final
arrival semantics. Native route geometry and confirmed stop mapping must be
connected explicitly to that architecture before replacing the preview with
guidance. No native callbacks have been connected to live UI/backend mutations.

## Runtime blocker found in the available package

`CopilotStartupModule.java` builds its Android foreground-service notification
with `.setSmallIcon(null)` and dereferences the current Activity without a null
guard. This is a source-level startup risk, not a reproduced device crash. Obtain
a corrected vendor build or implement and native-test a reviewed local repair
before binding. The package also has no supplied consumer shrinker rules; the
new broad `com.alk` keep rule is a starting point requiring release validation.

The readiness command deliberately exits nonzero for unresolved integration
requirements. It is a developer audit, not an application availability API or
an automatic license detector. No credential values are printed or embedded.

## Completion status against the requested priorities

| Priority | Status |
| --- | --- |
| 1. Android/iOS native readiness | Android dependency/build/manifest preparation implemented; native build unverified. iOS delivery inventory and instructions only; frameworks missing. |
| 2. Official module integration/initialization | Android package pinned and autolink configured. Neither platform initialized or licensed. |
| 3. Truck profiles/restrictions | Contracts audited; applying profiles blocked by licensing and unresolved restriction parity. |
| 4–5. Truck route and multi-stop calculation | CoPilot API sequence audited; no native calculation implemented or executed. Existing backend route planning remains. |
| 6–7. Turn-by-turn and voice | Not implemented; actual SDK startup/licensing/maps/device evidence required. |
| 8. Maneuver/ETA/distance callbacks | Actual callbacks audited; no synthetic callbacks and no live subscription wired to UI. |
| 9. Off-route/rerouting | Real out-of-route callback identified; rerouting behavior unverified and not enabled. |
| 10. Arrival/completion | Payload mismatch recorded; existing stop-plan behavior preserved, native completion not enabled. |
| 11. Existing UI/backend connection | Existing architecture preserved; guidance continues to fail closed. |
| 12. Preserve Flutter | Flutter/backend source preservation verified in the delivery report; no replacement/cutover. |

To proceed: supply the approved Trimble SDK version/delivery paths and secure
provisioning for truck, navigation and regional licenses/AMS plus installed maps
and any required map-staging key. Fix/validate native startup and restriction
mapping, build on functioning Android and macOS hosts, then demonstrate a real
truck route and turn-by-turn start. Only that evidence can advance operational status.

## Validation performed

After each of the three stages (package installation, native preparation/auditor,
and RN/toolchain alignment), all existing React Native and backend tests ran.
Each stage passed 50 RN tests and 82 backend tests; two database-dependent backend
tests remained skipped. TypeScript, ESLint and the app's Android/iOS codegen/wiring
checks passed. The three new ELF-auditor tests passed in stages two and three.
The RN 0.85 Android production-mode JavaScript bundle completed with 23 assets.

Android `:app:assembleDebug` on the aligned toolchain failed **before application
compilation**, while resolving `com.facebook.react.settings`: generated version
catalog compilation closed a JDK ZIP filesystem and raised `AccessDeniedException`
for `gradle-classloaders-9.3.1.jar`. Consequently no APK, native link, shrinker or
device result is claimed. The RN 0.85 SDK 36/Build Tools 36/NDK prerequisites are
installed locally; the earlier SDK 37 mismatch is no longer applicable. iOS
native compilation remains unavailable on this Windows host.

The final npm audit reports 13 moderate advisories, zero high/critical. No forced
dependency overrides were applied. This npm result does not audit proprietary
native binaries or establish release security/compliance.

The installed file manifest and preservation report accompany this document.
All 426 files covered by the original Flutter/backend preservation baseline
remain byte-identical. No commit, deployment, signing change or Flutter cutover
was performed.
