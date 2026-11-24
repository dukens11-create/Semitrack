# First real CoPilot truck session — P0 result

11 September 2026. **Stop condition B: blocked by external provisioning and vendor
contract questions. No CoPilot route, navigation, voice or rerouting session has
run. Actual CPIK callbacks observed: none.** No additional product features were added.

## Android build: exact failure and classification

The last native build failed before app compilation while resolving
`com.facebook.react.settings`. The terminal cause is:

```text
java.nio.file.AccessDeniedException: .../gradle-9.3.1/lib/gradle-classloaders-9.3.1.jar
sun.nio.fs.WindowsLinkSupport.getRealPath
sun.nio.fs.WindowsPath.toRealPath
jdk.nio.zipfs.ZipFileSystemProvider.removeFileSystem
jdk.nio.zipfs.ZipFileSystem.close
org.gradle.api.internal.catalog.SimpleGeneratedJavaClassCompiler.compile
```

This pass reproduced the same path-resolution/ZIP-close failure in a standalone
Java program with **no Gradle, React Native or CPIK execution**, on both Temurin
17.0.18 and Android Studio JBR 21.0.9. The JAR exists, is readable, has 83,267 bytes,
and its ZIP filesystem opens; resolving its real path and closing ZIPFS fail.
The failure is therefore a Windows filesystem-access problem in this execution
environment, not a missing commercial license. The exact security layer causing
the denial (ACL, execution sandbox or another host policy) is not established;
no ACL/security protection was altered. OpenJDK's
[Windows path implementation](https://raw.githubusercontent.com/openjdk/jdk17u/master/src/java.base/windows/classes/sun/nio/fs/WindowsLinkSupport.java)
resolves path components through Windows filesystem operations.

| Category | Finding |
| --- | --- |
| Repository/code defect | Corrected the earlier audit's nonexistent `VehicleType.TRUCK` reference to the actual `TRUCK_HEAVY_DUTY` export. Added a source-contract check, exhaustive profile assessment and a fail-closed adapter guard. No app-code cause of the current Gradle failure was established. |
| Local environment/toolchain | Confirmed Java path-resolution denial on two installed JDKs. SDK 36, Build Tools 36 and NDK 27.1 are present. ADB also fails with `Cannot mkdir '\.android': Permission denied`; setting Android user-home did not resolve it. Device connection status is unknown. |
| Missing external artifact/repository access | The npm SDK and Gradle distribution downloaded. Full Maven/native dependency resolution has not been reached, so later repository access is unverified. |
| Trimble licensing / AMS | No approved development asset/license provisioning supplied or connected. Independent runtime blocker, not the build error. |
| CoPilot maps | No licensed, installed device map set has been verified. Independent runtime prerequisite. |
| Vendor CPIK | Startup notification/activity issues and profile-setter result loss identified in source; actual runtime behavior unverified. |

**External build action:** use an Android Studio terminal or CI worker with valid
filesystem access and Android user state. From `apps/mobile-react-native`, run
`npm ci`, `npm run check`, then from `android` run
`./gradlew.bat :app:assembleDebug --no-daemon --stacktrace` (use `./gradlew` on Unix).
Set the host's valid `JAVA_HOME` and `ANDROID_HOME`; do not change signing or
licenses to fix a filesystem failure. `scripts/GradleJarProbe.java <jar-path>` can
first be run with `java` to verify that the denied operation works on that host.
The probe returns nonzero and prints the complete error on failure. Continue
triaging the first subsequent build failure; no successful native link is claimed.

## Startup: observed versus expected

**Actual startup status: not attempted.** The app still uses an unavailable
guidance boundary. No `CopilotStartupMgr.bindCoPilotService()` call was made.
There is no CPIK runtime exception, native startup stack or React Native startup
stack to attach. The stack above belongs to Gradle/JDK, not CoPilot.

Source-level execution path in the pinned `10.28.2-497` package:

```text
CopilotStartupMgr.bindCoPilotService()
  -> currentActivity.bindService(CopilotService, BIND_AUTO_CREATE)
  -> ServiceConnection.onServiceConnected()
  -> getNotificationForService(): Notification.Builder.setSmallIcon(null)
  -> CopilotBinder.startForeground(919, notification)
```

The notification icon is null and Activity access is unchecked. These are startup
risks; **no specific Android exception is asserted without reproduction**. The
vendor bind method is void, so awaiting it cannot confirm successful startup.
No catch-and-ignore repair or unverified patch was installed. Obtain a corrected
vendor delivery or native-test a local repair with a valid notification icon,
foreground Activity checks and explicit failure reporting on a working build host.

The [official Android setup](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/android-guide/)
and shipped source require licensing-hook values before startup. The pending
sequence is: register listeners; provision the selected licensing mode; obtain
location permission and a foreground Activity; bind once; await actual startup
and licensing callbacks; verify truck/navigation/region entitlements; install and
verify maps; create/read back a truck profile; only then add stops and calculate.
Render CoPilotView after startup. No map or license is needed to reproduce the
Java build probe. Licensed truck features and CoPilot maps are prerequisites for
the requested route/session. Bare service startup is not proof of either.

Current Android manifest configuration: custom fragment, internal app storage,
OpenGL, no background splash-suppressed startup; non-exported location foreground
service. Location/network/wake/notification permissions are declared. No AMS,
product key, map staging key or map region has been activated.

## Licensing/AMS provisioning matrix

Values must come from SemiTraX's Trimble agreement/Account Manager administrator.
The [license API](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/license/)
defines company/partner asset identities. The
[React Native LicenseMgr contract](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/licensemgr/)
provides activation and feature queries. SDK download access and the existing
backend's Trimble web-service key do not establish CPIK entitlement.

| Item | Source and configuration | Android / iOS | Secret, app presence, source control |
| --- | --- | --- | --- |
| `assetID` | AMS administrator assigns an asset with purchased/evaluation features; supply with the selected company/partner identity before startup. | Both; confirm platform/device assignment. | May identify a driver/device. Treat as confidential licensing material; native runtime presence allowed, provision outside source control. |
| `companyID` | Trimble-assigned company identifier; Android `LicenseListener.setAMSLoginInfo(assetID, companyID)`. | Both; two-argument method documented for iOS, validate delivered bridge. | Identifier rather than password, but part of a licensing credential tuple. Native runtime only in this design; not committed. |
| `externalAccountID`, `partnerID` | Partner/end-customer identity and Trimble partner identifier; alternative to company mode. Android uses `setAMSLoginInfoWithExternalAccount(...)`. | Both licensing models supported; verify exact iOS method in delivered framework. | Sensitive identifiers, not independent API secrets; provision outside source control, available in native memory as needed. |
| Product/enterprise activation key | Trimble issues the key if that licensing scheme is approved; `LicenseMgr.activateLicense(key, deviceID)` after licensing-ready. | Both, subject to delivered API/version. Alternative to AMS, not automatically an additional requirement. | Secret activation material; secure native provisioning only, never JS bundle or repository. |
| `deviceID` | Stable identifier under the agreed device/asset policy; required by key activation and potentially mobile AMS policy. | Confirm both platforms' approved identity and debug/production registration rules. | Sensitive identifier; can exist in the app's secure native state. Do not invent a hardware ID or use a shared sample value. |
| Map-region upgrade key | Trimble, only if the agreement requires the region-upgrade hook; Android `setKeyForMapRegionUpgradeKeyHook(...)`. | Confirm scheme and iOS bridge parity. | Secret; provision outside source control; not a substitute for truck licensing. |
| `mapStagingAPIKey` | Trimble, only for an approved staging workflow; Android `LicenseListener.setMapStagingAPIKey(...)`. | iOS delivery/API support must be confirmed. | Secret; native provisioning only. Map staging must not be assumed to enable full navigation or heavy-truck features. |
| Feature/region entitlements | AMS/key assignment: full navigation, heavy-duty truck and every required map region. | Both platforms must be entitled. | Entitlements are not keys. Query native feature statuses; never infer from configuration presence. |

For **development**, request an expressly authorized evaluation/development asset
with suitable expiry, truck, region and voice access. For **production**, provision
the contracted fleet assets and permitted app/device identities. No development
credential should silently become a production default. Whether assignments can
be shared across Android/iOS or migration debug/production app IDs needs Trimble
confirmation. AMS administrator passwords and backend service secrets have no
place inside the client.

`copilot.configuration.example.json` intentionally contains invalid empty
references and map values. `CopilotConfiguration.ts` validates non-secret
configuration and an opaque native secure-store reference; `CopilotProvisioning`
is an interface only. No secure credential reader/activation implementation has
been invented. Unknown credential fields are rejected without echoing their values.

## Map data required for the first Android session

The exact region/package cannot be selected from this repository: it must cover
the approved test origin, destination **and reroute corridor**, and be included in
the asset's licensed regions. No device map inventory or corridor has been supplied.
Resolve region keys using the installed `MapRegion` module; do not hardcode enum
ordinals or treat a display-map download as CPIK map installation.

Using the [MapDataMgr guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/mapdatamgr/)
and shipped bridge:

1. After licensing, query `getLicensedMapList()` and `getInstalledMaps()`.
2. Use `checkMapUpdate(region, year, quarter)` to obtain compatible download data.
3. Require at least 1.5 times the reported download size in free storage. Internal
   app storage is configured; keep navigation data and required components intact.
4. Invoke `downloadMap(regions, disabledComponents, year, quarter, version, overwrite)`
   on the appropriate native execution thread. Empty disabled-components retains
   the delivery's components. A non-overwriting addition requires matching map versions.
5. Observe `onMapDownloadResponse` and `onMapdataUpdate`; an accepted request or
   completed transfer alone is insufficient. Verify installation completion and
   re-query installed region/year/quarter/version before enabling profile work.

The native package exposes download/installation states and failures including
unlicensed, invalid connection/arguments, validation/version mismatch, busy manager,
insufficient disk, paused/cancelled, and generic failure. Preserve each native
error; do not retry by disabling restrictions. `pauseMapDownload`, `resumeMapDownload`
and `cancelMapDownload` apply to a specific region. Initial-region hooks must be
configured before they are invoked; the bridge emits `selectRegion`.

Initial licensing/downloads need service access. Offline navigation must be tested
with the licensed, installed dataset and applicable entitlement validity; online
traffic/updates are separately unavailable offline. Voice availability/download
must be verified through SpeechMgr. Trimble must confirm the exact compatible map
version, regional package, offline license behavior and any first-install restart
requirement for the supplied asset. No CoPilot maps have been installed by this pass.

## Exhaustive SemiTraX truck mapping

Classification covers the current model; metadata remains owned by SemiTraX.
The shipped native `VehicleRoutingProfile` and `VehicleDimensions` signatures were
also inspected. They do not expose axle-count or trailer-configuration setters.
Their setters return modification results, but the RN model discards those
results: future integration must validate return outcomes/readback, never just
accept the bridge acknowledgement. See the
[native RouteMgr/profile contract](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/).

| Field | Classification | Mapping / blocking decision |
| --- | --- | --- |
| Vehicle type (implicit commercial truck) | SUPPORTED DIRECTLY | Runtime `VehicleType.TRUCK_HEAVY_DUTY`; never AUTO. Corrected earlier nonexistent TRUCK constant. |
| `id` | NOT SUPPORTED | Retained SemiTraX metadata; not a truck restriction. |
| `name` | SUPPORTED DIRECTLY | Native profile name; must be unique and read back with the correct type. |
| `isDefault` | NOT SUPPORTED | Retained SemiTraX metadata. |
| `heightFt` | SUPPORTED WITH CONVERSION | `dims.height`, inches, round upward. |
| `widthFt` | SUPPORTED WITH CONVERSION | `dims.width`, inches, round upward. |
| `lengthFt` | SUPPORTED WITH CONVERSION | `dims.length`, inches, round upward; confirm complete combination measurement. |
| `weightLbs` | SUPPORTED DIRECTLY | `dims.totalWeight`, pounds; no lossy conversion. |
| `currentWeightLbs` | REQUIRES TRIMBLE CONFIRMATION | A single native total-weight field cannot independently retain gross and current weights; reviewed policy required. Blocks when supplied. |
| `weightPerAxleLbs` | SUPPORTED DIRECTLY | `dims.weightPerAxle`, pounds; not individual axle/group weights. Null/unknown is blocked. |
| `axleCount` | NOT SUPPORTED | Mandatory SemiTraX restriction; blocks every current profile. |
| `tractorType` | NOT SUPPORTED | Retained descriptive metadata; existing backend routing serializer excludes it. |
| `trailerType` | NOT SUPPORTED | Blocks when supplied; no inferred substitute. |
| `trailerCount` | NOT SUPPORTED | Blocks; even zero cannot bypass an unreviewed configuration mapping. |
| `unitNumber`, `trailerNumber` | NOT SUPPORTED | Retained vehicle identity metadata. |
| `hazmatEnabled` | SUPPORTED WITH CONVERSION | Disabled selects NONE; enabled requires a representable class. |
| `hazardousGoods` | REQUIRES TRIMBLE CONFIRMATION | Single matching EXPLOSIVE/FLAMMABLE/RADIOACTIVE/INHALANT/HARMFUL_TO_WATER names recorded; multiple classes, gas, corrosive and unmatched categories blocked. No GENERAL/first-class fallback. |
| `avoidTolls` | SUPPORTED WITH CONVERSION | Boolean -> native ALWAYS_AVOID / NO_RESTRICTION preference; device validation still required. |
| `avoidFerries` | REQUIRES TRIMBLE CONFIRMATION | Discouraging ferries is not proven equivalent to strict avoidance; true blocks. |
| `avoidHighways` | NOT SUPPORTED | True blocks; no exposed corresponding profile field. |
| `avoidResidential` | NOT SUPPORTED | True blocks. |
| `avoidDirtRoads` | NOT SUPPORTED | True blocks. |

The code produces **partial conversion evidence, not a CPIK routing payload**.
The guard always rejects current profiles because mandatory restrictions cannot
be represented. It is connected to `NativeGuidanceAdapter.setTruckProfile` before
any native mutation. Metadata is retained in the existing model; no field is
silently removed. A restriction-display setting is not proof of routing enforcement.

## Route, navigation, rerouting and 16 KB results

| Required evidence | Actual result |
| --- | --- |
| Known test origin/destination sent to CPIK | Not sent; prerequisites blocked. Select an approved truck-accessible test corridor after entitlement/region confirmation. |
| CPIK route, active truck profile, geometry, distance, ETA, maneuvers | Not produced or observed. Existing backend routes are not counted as CPIK results. |
| GPS -> route -> active guidance -> maneuver/voice -> progress -> arrival | Not executed. No navigation-success or arrival events emitted by this work. |
| Off-route -> truck-safe reroute -> continued guidance/voice/progress | Not executed; unchanged truck-profile enforcement cannot yet be demonstrated. |
| Actual CPIK callback trace | Empty. Unit-test evidence is not an SDK callback recording. |
| Four vendor ELF binaries | Prior binary-level 16 KB alignment pass retained. |
| Final APK/AAB, every dependency, ZIP alignment | No artifact; UNVERIFIED. |
| Installation and navigation on a 16 KB environment | Not executed; UNVERIFIED. |

After a native artifact exists, audit every extracted `.so`, AAB page-alignment
configuration and generated APK ZIP alignment, then test on a device reporting
16384-byte pages. No whole-app compliance claim is made.

## iOS prerequisites

The [official iOS guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/ios-guide/)
requires `CoPilotIntegrationKit.framework`, `CPIKReactNative.framework` and the
delivered resource bundles. The npm package does not supply these. Obtain the
matching, licensed delivery and its native dependencies; verify device/simulator
slices, minimum OS, privacy resources, linkage/signing and RN 0.85/New Architecture
compatibility on macOS/Xcode/CocoaPods. Existing native location permission text
and background-location capability must be validated for real guidance. If the
supplied voice implementation requires a background-audio capability/session,
follow that delivery's instructions rather than guessing entitlements.

Securely provision the approved iOS licensing identity, confirm region/truck
entitlements and install compatible CoPilot maps/voices. Register callbacks before
the documented iOS startup (`Copilot.startNavApp()`), then verify licensing/maps
before creating a route or rendering the guidance view. No iOS binary linking,
license activation, map installation or device session has occurred.

## Tests and external handoff

All 92 React Native tests (50 existing plus 42 P0 regressions), three ELF-auditor
tests, TypeScript, ESLint and native source/codegen checks pass. Backend results
remain 82 passing with two database-dependent tests skipped. The regressions cover invalid/secret
configuration, startup states, absent licensing/maps, region/version mismatch,
location permission, unit conversion, every unsupported restriction, unchanged
navigation availability and preserved CPIK error causes. Unit fixtures are not
CoPilot emulation. Full counts and logs are in the delivery evidence.

The next external actions are:

1. Restore a functioning native build/device environment and return the first
   successful build or next precise error. No licensing workaround is needed to build.
2. Have Trimble/AMS administration issue an approved development asset with heavy
   truck, full navigation, regional and voice access; provide secure provisioning
   references, **not credential values in source control or chat**.
3. Obtain a definitive mapping/native extension for axle/trailer and road
   restrictions, hazmat combinations, ferry semantics and weight policy.
4. Resolve the startup icon/Activity handling and profile-result loss with a
   supported vendor delivery or a native-tested repair; confirm callback behavior
   during background operation and arrival payload semantics.
5. Obtain the compatible map/voice package identifiers, installation policy and
   offline entitlement conditions, plus the complete iOS SDK delivery.

Only after these gates pass should one real route/session/reroute be attempted.
The supplied repository contains no assets, keys or configuration that can resolve
the external commercial entitlement and unsupported-restriction questions.
