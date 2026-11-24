# SemiTraX CoPilot startup and readiness audit

11 September 2026. Pinned React Native 0.85.0 and CPIK 10.28.2-497.

The stationary test reached the required provisioning stop. The six required native manager modules, six listener modules, startup module and CoPilot view manager were present on R5CRC2ZHA7H. React Native rendered the provisioning message and existing backend-configuration screen. Process 25290 stayed alive and no FATAL EXCEPTION appeared in the captured process log. This proves module availability and safe handling of absent provisioning, not CoPilot initialization or navigation.

## What was implemented, and what remains disabled

CopilotLifecycle subscribes before provisioning/startup, separates initialized/licensingReady/mapsReady/readyToAddStops, checks full-navigation and heavy-truck entitlement as additional gates, rejects stale asynchronous results, clears readiness on shutdown, and exposes the requested error codes. CopilotRuntime supplies documented read-only license/map/readiness queries. CopilotStatus mounts independently of backend/authentication setup, reports the provisioning failure without crashing the app, and provides an assertive commercial-restriction warning banner.

The implementation is a readiness observer and fail-closed boundary, not a completed native navigation engine. prepareProvisioning currently returns null because the repository has no connected secure credential provider. startNative deliberately rejects: the pinned vendor host must be made safe before binding is enabled. There is no success stub, sample credential, automatic map download, route construction, or guidance activation. Existing NativeGuidanceAdapter and truck-profile guards are unchanged. A successful unit-test progression is not device evidence.

## Android integration

The [official Android setup guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/android-guide/) describes package integration, service startup, licensing hooks and the native view. Current react-native.config.js integrates CPIKPackagesHolder through RN autolinking. The physical-device NativeModules checks establish that the required managers/listeners were actually exported.

The manifest declares CopilotService as enabled, non-exported, with location foreground-service type. It declares fine/coarse location, network, wake-lock, foreground-service/location and notification permissions. CoPilot metadata selects a custom fragment, internal storage, foreground splash startup and OpenGL. Runtime location grants/foreground-service operation remain untested. Contacts and legacy external-storage access were not added; current app uses internal storage and has no contacts feature. The guide's sample also includes mcc/mnc/locale/fontScale configuration handling absent from this RN manifest; configuration-change behavior remains a pre-navigation native validation item. No manifest changes were made.

The native CopilotView manager is present, but its view was not mounted. Shipped createViewInstance assumes CopilotMgr.getView() exists. Rendering it before initialization would be unsafe.

Pinned CopilotStartupModule.java calls bindService through an unchecked currentActivity, then uses Notification.Builder.setSmallIcon(null) before startForeground. This is a source-proven risk, not an observed CPIK crash. JS try/catch cannot catch every asynchronous Android service exception. Before enabling binding, implement and native-test a safe host with foreground Activity/location checks, a valid small icon, explicit failure propagation and orderly service lifetime, or obtain a supported vendor fix without changing the pinned version.

## Licensing and maps

The [React Native LicenseMgr contract](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/licensemgr/) requires pre-start AMS setup and explains that isLicensingReady concerns readiness for licensing operations. It does not establish heavy-truck entitlement. The prepared non-secret example chooses ams-company but contains empty references and invalid map values. The schema also allows ams-external-account or product-key; neither is provisioned or selected as a fallback. No credential or entitlement is inferred from SDK download access or backend Trimble access.

Device result: COPILOT_LICENSE_PROVISIONING_REQUIRED at secure-provisioning. No AMS login, product activation or license API query was performed. Actual device license inventory is unknown. Secure provisioning, the approved licensing method and exact licensed map region/version must be supplied before startup can proceed. Credentials must never enter the repository or logs.

The [React Native MapDataMgr contract](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/mapdatamgr/) is implemented as getLicensedMapList, getInstalledMaps and checkMapUpdate queries. The inventory parser requires the configured region to be licensed and an exact installed year/quarter/version match. Download callbacks only invalidate/requery readiness. Update information can be UNKNOWN; it never fabricates CURRENT. No maps were queried, downloaded, installed or deleted on the phone because provisioning stopped the test. Mapbox display availability is never evidence of CoPilot maps.

The [documented callbacks](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/hooks-and-callbacks/) include onCPStartup, onLicensingReady and onReadyToAddStops. The observer subscribes before any startup attempt. isCopilotReadyToAddStops is independently queried; binding completion cannot set initialized. License/map changes invalidate readiness before rechecking. Native callbacks were not emitted during the provisioning-blocked device run.

## Truck profile and exact backend-route compatibility

The [React Native profile objects](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/json-objects/#vehicleroutingprofile) expose heavy-truck type, dimensions, total weight, weight per axle and hazard/routing preferences. Existing assessment records conservative feet-to-inches conversions and supported single hazard classes. Axle count and trailer configuration are not represented by the pinned RN profile. Gross/current-weight policy, multi-class hazmat, strict ferry avoidance and additional highway/residential/dirt restrictions remain unsupported or require confirmation. Existing profiles fail closed; partial conversion evidence is never applied as a native profile. No truck restriction was removed.

The [React Native RouteMgr documentation](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/routemgr/) provides RouteSync managed-route interfaces. That does not prove exact compatibility with this backend's RoutePath coordinates/maneuvers. A concrete contract mismatch exists: docs show coordinate objects for sendManagedRouteByObjects, while pinned RouteSyncModule.java reads strings, splits pipe/comma delimiters and calls the native managed-route API with fixed compliance parameters. A bridge acknowledgement also does not prove identical road selection, map-version agreement or preserved truck restrictions. The backend currently exposes routeGeometry from RoutePath/GeoTunnel reports, not a proven CPIK managed-route contract.

BACKEND_ROUTE_TO_COPILOT_GUIDANCE_COMPATIBILITY: REQUIRES_TRIMBLE_CONFIRMATION.

No route geometry was sent, no stops were added, no destination was invented, and no route was calculated. Route-calculation, alternative-route, RouteSync and off-route event names are observed without enabling route actions. A native completion callback alone never enables guidance.

## Guidance, speech and controlled test plan

The [React Native GuidanceMgr API](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/guidancemgr/) exposes current/upcoming maneuver information, lane guidance, position, ETA and distance. Observer subscriptions cover maneuver/progress, speed, lanes, arrival, off-route/rejoin and route recalculation events. This pass records event names only; a production guidance payload reducer, validated units/arrival semantics and a verified native route remain outstanding. Pinned arrival callbacks omit the arrivalStatus field shown in the documentation, so final-stop booleans must not be substituted for complete arrival semantics.

Commercial callbacks onTruckRestricted, onTruckWarningUpdate, onEnvironmentalZone and onPedestrianLink trigger a persistent, prominent alert rather than silently disappearing. No restriction callback was observed on the physical device; no display setting is treated as routing enforcement.

The [React Native SpeechMgr API](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/speechmgr/) provides current language/voice, language information, volume/mute controls and playSpeechSample. The installed package also exposes the documented speech/voice-download callbacks. This audit did not select/download a voice, speak a sample, modify mute state or test audio. Speech callbacks and returned API success cannot prove audibility; physical confirmation remains required.

Only after approved licensing, installed maps, safe native startup, precise location, truck-profile parity and backend-route compatibility are established:

1. Select an approved truck-accessible stationary origin/destination and reroute corridor covered by the licensed map region; do not reuse documentation sample coordinates.
2. Register lifecycle, licensing, map, route, commercial-warning, guidance and speech observers before startup or route actions. Apply/read back a complete validated heavy-truck profile before any stop.
3. Check ready-to-add-stops immediately before a route action. Use a documented preview/calculation path reviewed to avoid premature guidance. Verify stop list, destination, profile, calculated route, distance, ETA, errors and requested alternatives. Treat failed calculation as a stop.
4. Resolve exact backend-route parity with Trimble, including supported RouteSync payload format, map versions, snapping/compliance and truck restrictions. Do not replace the authoritative path with independent passenger routing.
5. After stationary route approval, verify the selected installed voice and an audible sample on the phone. Confirm permission/background notification behavior before a controlled driving test.
6. For a supervised missed-turn test, record the active truck profile before/after deviation, off-route/recalculation/new-route callbacks, changed maneuvers/ETA and continued audible guidance. Never intentionally enter a prohibited road. Abort on missing truck constraints, warnings without safe handling, licensing/map loss, crash or passenger fallback.

Steps 1–6 were not executed. The device test stopped at absent provisioning as requested.

## Validation and artifact scope

TypeScript: PASS. Scoped ESLint: PASS. React Native tests: 113 passed, 0 failed (21 new lifecycle tests, all 92 existing tests retained). Existing native source/codegen check: PASS; that check is not a native build. Unit coverage includes readiness progression, absent module/license/maps, callbacks, startup rejection/timeout, missing truck entitlement, ready-to-add-stops, unsupported truck profile, route/guidance failure, warnings, shutdown and stale/disposed asynchronous results.

Device evidence uses the already installed debug APK with current canonical JavaScript served by Metro. The APK file was not rebuilt, overwritten or reinstalled. Previous build/16-KB results remain historical evidence for that unchanged binary; this pass makes no new whole-APK or runtime page-size claim. RN, CPIK, Mapbox, dependency lockfile and arm64-v8a/x86_64 ABI configuration remain unchanged. No backend, Flutter, Android source, vendor binary, navigation architecture or routing behavior was changed. No commit/push.

The captured startup log also includes an Android WindowManager BadTokenException and RN ReactNoCrashSoftException while the React context was becoming ready. The RN UI subsequently rendered and no FATAL EXCEPTION occurred. These are not evidence of a CPIK service crash; the service was not bound. Preserve the log for a separate startup-overlay review.

Files changed in this pass, relative to apps/mobile-react-native:
- src/services/copilot/CopilotLifecycle.ts (new)
- src/services/copilot/CopilotRuntime.ts (new)
- src/components/CopilotStatus.tsx (new)
- src/app/AppRoot.tsx (status component only)
- __tests__/copilot-lifecycle.test.ts (new)
- COPILOT_STARTUP_LIFECYCLE.md (this report)

The original dirty repository remains dirty. No unrelated work was staged or removed.

Next safe action: arrange approved Trimble provisioning and map-region/version metadata through a secure channel; implement/connect the secure provisioning boundary and validate a safe native startup host before enabling service binding. Resolve truck-profile and RouteSync contract gaps before any route or guidance test. Backend SEMITRAX_API_URL remains independently unconfigured and was not changed.
