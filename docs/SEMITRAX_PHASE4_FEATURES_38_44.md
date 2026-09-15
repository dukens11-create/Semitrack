# SemiTraX Phase 4 — Features 38–44

Audit completed 15 September 2026 UTC (14 September 2026, America/Los_Angeles).

**SAFE TO REVIEW: YES. Production/store release: NOT READY.**

This reconciled report covers the complete eleven-file Phase-4 working tree, including the later Admin/API Trimble provider-health correction and the independent-review repairs. During this repair, only this repository report and `check-native.cjs` changed; the Xcode project and eight Admin/API files were preserved. The standalone release-kit guard and documentation were also updated outside the repository. Historical validation is distinguished from repair validation below. This does not certify native compilation, production configuration, store acceptance or operational navigation.

## 1. Starting checkpoint and environment recovery

- Repository: `C:\Users\duken\Documents\Codex\2026-09-03\semitrack-navigation-reimplementation\work\semitrack`.
- Required/current branch: `codex/semitrax-react-native-prelicense`.
- Protected Phase-3 checkpoint and current HEAD: `423d152589da362b4615f355801acd9c5dc8c2a4`.
- Local remote-tracking ref `origin/codex/semitrax-react-native-prelicense` resolves to the same commit. No fetch/push was performed; this verifies the local remote-tracking ref, supplemented by the user's normal-PowerShell remote verification.
- First execution gate ran exactly `whoami`, `Get-Location`, `git status -sb`, `git rev-parse HEAD`, and `git rev-parse --abbrev-ref HEAD` in the requested repository. All succeeded. Identity: `duke\codexsandboxoffline`.
- The earlier `helper_unknown_error: setup refresh had errors` did not recur. Shell execution is available; Android build-specific host restrictions remain.
- At the original Phase-4 continuation, tracked modifications were the Xcode project and native check. The later Admin correction added eight source/test paths; the current complete inventory is in section 4. `test/failures/` remains untracked. Its contents were not opened, inventoried, hashed, edited, deleted or staged.

## 2. Initial feature matrix

| Feature | Starting status | Outstanding acceptance |
| --- | --- | --- |
| 38 Android Auto | EXTERNALLY BLOCKED | Application integration absent; pinned CPIK support unverified |
| 39 Apple CarPlay | EXTERNALLY BLOCKED | Apple entitlement, supported integration, iOS build and runtime |
| 40 iOS production readiness | PARTIAL | Source/static review plus Mac, signing and privacy/store validation |
| 41 Android 16 KB readiness | PARTIAL | New release artifact, complete packaged-library audit and device evidence |
| 42 CoPilot active navigation | EXTERNALLY BLOCKED | Secure provisioning, licenses, maps, startup, profile parity, runtime |
| 43 Physical road testing | NOT STARTED | No physical acceptance at this checkpoint |
| 44 Production/store release | PARTIAL / NOT READY | Production configuration, operations, signing and store gates |

## 3. Final feature matrix

| Feature | Final status | Result of this continuation |
| --- | --- | --- |
| 38 Android Auto | EXTERNALLY BLOCKED | App and pinned vendor source audited; no supported integration or runtime established |
| 39 Apple CarPlay | EXTERNALLY BLOCKED | iOS foundation audited; no entitlement, CarPlay scene/integration or runtime |
| 40 iOS production readiness | PARTIAL | Privacy resource wiring confirmed; bridge, XML and lifecycle/configuration static checks pass; Xcode/signing unverified |
| 41 Android 16 KB readiness | PARTIAL | Static/codegen PASS; ELF auditor 3/3; four vendor binaries PT_LOAD and RELRO alignment PASS; release build externally blocked |
| 42 CoPilot active navigation | EXTERNALLY BLOCKED / FAIL-CLOSED | No binding/startup enabled; RouteSync source evidence documented without RoutePath equivalence claim |
| 43 Physical road testing | NOT STARTED | Complete acceptance checklist prepared; no road result recorded |
| 44 Production/store release | PARTIAL / NOT READY | Source/configuration and operating requirements audited; Admin tests/build pass; no release/deployment |

## 4. Exact Phase-4 inventory and repair scope

Repository diff from the protected checkpoint:

| Repository-relative path | Purpose | Changed by this repair |
| --- | --- | --- |
| `apps/admin/src/App.tsx` | Trimble Routing metric, expiry and failed-refresh handling | NO |
| `apps/admin/src/types.ts` | Typed Trimble health response contract | NO |
| `apps/admin/src/providerHealth.ts` | Conservative health display and freshness mapping | NO |
| `apps/admin/test/provider-health.test.cjs` | Provider metric/rendering regression tests | NO |
| `apps/api/src/modules/analytics/adminAnalytics.service.ts` | Backend Trimble health response and retired-provider filtering | NO |
| `apps/api/src/modules/analytics/providerHealth.ts` | Health evidence classifier and current-provider filter | NO |
| `apps/api/src/server.ts` | Correct provider metadata, health lists and issue counts | NO |
| `apps/api/test/providerHealth.test.ts` | Provider classifier, dashboard service and endpoint-handler tests | NO |
| `apps/mobile-react-native/ios/SemiTrax.xcodeproj/project.pbxproj` | Add privacy manifest to application Resources | NO |
| `apps/mobile-react-native/scripts/check-native.cjs` | Check bridge methods and actual privacy PBX object graph | YES |
| `docs/SEMITRAX_PHASE4_FEATURES_38_44.md` | Reconciled evidence, inventory and review disposition | YES |

The Xcode edit adds one `PBXBuildFile` (`F40000000000000000000001`) referring to existing privacy file reference `13B07FB81A68108700A75B9A`, and places it in resource phase `13B07F8E1A680F5B00A75B9A`. Application target `13B07F861A680F5B00A75B9A` includes that phase. The referenced `SemiTrax/PrivacyInfo.xcprivacy` exists; the added object ID is unique. No Xcode rewrite or new manifest was needed during repair.

The native check retains every pre-existing assertion and checks `createOperationId` and `locationPermissionStatus` in generated Android/iOS contracts and Kotlin/Objective-C++ implementations. Its repaired privacy check parses the OpenStep object dictionary and follows the actual project/application/resource/build-file/file-reference relationships. Duplicate keys, missing/dangling references, incorrect object types and duplicate memberships fail closed. These are deterministic source checks, not compiler/signature/runtime certification.

Byte-level SHA-256: the Xcode project below remains unchanged. The original native-check hash is retained as historical evidence; the release kit pins the repaired file's current hash along with all other ten inventory files.

| File | SHA-256 |
| --- | --- |
| `project.pbxproj` | `6ecea9187d8aaf92dcc76c7eadbfff44bf65e90c68a67e19df9a8a6e920697f6` |
| `check-native.cjs` before repair (historical) | `68c7a9f87420d31067fa06953a183097f570e6c927441234ba234164fcf541ba` |
| `check-native.cjs` after repair | `331c696982a89b5d0e816c40ae4c3d0a27b75b220aa19a14f84cb3b73c4ebeb0` |

External workspace deliverables are under `C:\Users\duken\Documents\Codex\2026-09-14\files-pasted-by-the-user-semitrax\outputs`: a report copy, `Invoke-SemiTraxPhase4Release.ps1`, its unchanged `phase4-package-audit.cjs` companion, release-kit README and ZIP. These remain outside the repository checkpoint. Intermediate historical evidence is in `work\phase4`; repair logs and in-memory test harnesses are in `work\phase4-repair`. Native generated check outputs and Admin/API build outputs are ignored products. Do not include these, `test/failures/`, caches, dependencies, environment files or signing material in the checkpoint. No staging was performed.

## 5. Native and affected validation

| Check | Result and evidence timing |
| --- | --- |
| `git diff --check` | PASS; LF-to-CRLF notices are warnings, not errors |
| `node scripts/check-native.cjs` from RN app | PASS; regenerated schema plus Android and iOS bridge outputs |
| Added assertions actually execute | Repair PASS: 28 in-memory negative controls and 3 positive controls, described below |
| Xcode resource object graph | PASS; target → resource phase → unique build file → existing manifest |
| Info.plist, PrivacyInfo.xcprivacy, shared scheme XML parsing | Historical Phase-4 PASS; external DTD resolution disabled; files unchanged |
| iOS source/configuration checks | Historical Phase-4 PASS; 9 focused assertions described below |
| `node --test scripts/check-android-page-size.test.cjs` | Historical Phase-4 PASS: 3 tests, 0 failed/skipped |
| `node scripts/check-copilot-setup.cjs` | Historical expected exit 1: operational prerequisites remain blocked; pinned package/RN version and all four ELF binaries inspected |
| Additional CoPilot GNU_RELRO inspection | Historical Phase-4 PASS: four binaries; 16 KB-aligned RELRO ends |
| Companion RELRO checker controls | Historical Phase-4 PASS: ELF32/ELF64, little/big endian, aligned/misaligned ends (8 assertions) |
| Native compilation / linking / R8 | NOT VERIFIED; release attempt stopped in Gradle wrapper |

Repair negative controls execute the repaired check script in a Node VM with freshly generated native files. Filesystem reads are transformed in memory; source files are never edited by controls. Eight cases remove each new bridge method from generated Java/header and implemented Kotlin/Objective-C++. Twenty PBX cases cover absent file/build objects, absent membership, dangling references, a file-reference ID used instead of a build-file ID, detached target/phase, wrong object/product types, duplicate keys/build relationships/membership, wrong manifest path/source tree, malformed delimiters and trailing input. All 28 fail with their expected validation errors. Three positive controls pass: baseline, removal of privacy/resource-section comments, and punctuation/comment-like text inside a quoted PBX string. Code generation ran normally; subprocess generation was stubbed only inside the negative-control harness.

Historical original validation had nine negative controls, including removal of a resource comment. That result is preserved as historical evidence only. The repaired privacy assertion uses PBX object IDs and properties, not comment labels. The static parser supports the current project's OpenStep dictionary syntax and rejects unsupported syntax; it is not a substitute for Xcode archive validation.

The nine focused iOS assertions check ATS arbitrary-loads denial, both location permission descriptions, location background mode, distinct release/debug identifiers, release environment generation, bundled release JavaScript, stopping foreground-only tracking on background, precise/Always authorization gates, and invalidation cleanup. Source inspection supplements these checks; macOS compilation is still required.

## 6. Admin/API correction and repair validation

Executed again after repair using existing local dependencies, without reinstalling:

```text
Admin: node --experimental-strip-types --test test/*.cjs test/*.ts
28 passed; 0 failed; 0 skipped

Admin provider: node --experimental-strip-types --test test/provider-health.test.cjs
7 passed; 0 failed; 0 skipped (included in the 28 above)

API: node --experimental-strip-types --test test/providerHealth.test.ts test/adminAnalytics.test.ts test/trimbleProvider.test.ts test/productionConfiguration.test.ts test/p0Routing.test.ts
62 passed; 0 failed; 0 skipped

API provider: node --experimental-strip-types --test test/providerHealth.test.ts
7 passed; 0 failed; 0 skipped (included in the 62 above)

npm.cmd run build
tsc -b && vite build --configLoader runner
Admin PASS: TypeScript and Vite 6.4.3; 31 modules transformed

API: npm.cmd run build
PASS: tsc -p tsconfig.json (built before API tests)
```

Tests include HTTP error redaction, refresh/logout races, malformed login, stalled response deadlines, dispatch rendering, truck verification, all four provider UI states, stale/invalid health evidence and failed refresh handling. Focused API coverage includes actual dashboard-service and extracted endpoint-handler behavior with mocks, retired-provider filtering, Trimble routing restrictions and configuration guards. These provider-specific tests also passed in the independent review (7 Admin and 7 API) and have passed again after repair. They are not live HTTP/auth/database/provider integration tests. Builds compile locally; they do not verify a deployed endpoint. Production `VITE_API_URL` must be explicitly set to the approved HTTPS API; `.env.example` is a localhost development example.

Current evidence: `admin-tests.log`, `admin-provider-tests.log`, `api-focused-tests.log`, `api-provider-tests.log`, `admin-build.log`, `api-build.log`, `native.log` and `native-negative-controls.log` in `work\phase4-repair`. Historical original Phase-4 evidence remains in `work\phase4`: 21 Admin tests and the 30-module build, native/static, ELF and CoPilot logs. Those earlier values describe the tree before the Admin correction, not the final tree.

### Trimble status data source and limits

The dashboard API calls `trimbleRoutingHealth` using the trimmed Trimble configuration flag and actual selected `ProviderSyncState` fields: provider, data type, status, last success, last attempt and last error. Missing configuration is NOT CONFIGURED. Configuration with no routing-specific health result is DEGRADED. A recorded ERROR/DISABLED routing state is UNAVAILABLE. OPERATIONAL requires actual Trimble/ROUTING records that are all HEALTHY, error-free and less than five minutes old, with no future success or later attempt. The API returns an expiry; Admin expires green evidence and suppresses it on a pending/failed dashboard refresh.

No Trimble routing-health writer/probe was found in current API source. Existing writes in `dotFeedService.ts` are DOT feeds, whose configured data types are ROAD_EVENTS/CAMERAS; they cannot prove routing health. `ProviderSyncState.dataType` itself is a string, not a restriction preventing a future routing record. With current producers alone, a configured deployment remains DEGRADED until genuine routing-specific evidence exists. No environment variable alone creates OPERATIONAL, no synthetic successful record was inserted, and no production health/configuration was queried.

## 7. Android release attempt and 16 KB status

| Required distinction | Final result |
| --- | --- |
| STATIC PASS | YES — scoped native/codegen/configuration and supplied CoPilot ELF checks |
| RELEASE BUILD PASS | NO — blocked before application compilation |
| FINAL PACKAGE 16 KB PASS | UNVERIFIED — no new APK/AAB to inspect |
| DEVICE VERIFIED | NO |
| New Android artifact path | None |
| New Android artifact SHA-256 | Not available; no artifact built |
| Packaged ABIs / packaged CoPilot | UNVERIFIED; configured ABIs are not package evidence |

### Exact attempted build failures

From the Android directory, `gradlew.bat :app:assembleRelease --no-daemon --console=plain` exited 1:

```text
Exception in thread "main" java.lang.RuntimeException: Could not create parent directory for lock file C:\.gradle\wrapper\dists\gradle-9.3.1-bin\23ovyewtku6u96viwx3xl3oks\gradle-9.3.1-bin.zip.lck
    at org.gradle.wrapper.GradleWrapperMain.main(SourceFile:65)
```

A retry with `--offline --gradle-user-home` targeting the existing workspace cache encountered the same wrapper lock-path error. Setting the process-local `GRADLE_USER_HOME` explicitly to the workspace cache progressed beyond it. That cache contains Gradle 8.14, not the required 9.3.1 distribution. The wrapper attempted its distribution download, even though the Gradle task was requested offline, and exited 1:

```text
Downloading https://services.gradle.org/distributions/gradle-9.3.1-bin.zip
Exception in thread "main" java.net.SocketException: Permission denied: getsockopt
```

Logs: `android-release.log`, `android-release-workspace-cache.log`, `android-release-cache-env.log`. The prior Gradle/JDK ZIPFS `AccessDeniedException` is historical evidence in `COPILOT_P0_REPORT.md`; this continuation did not reach that stage and does not claim that problem has disappeared. No ACL, execution policy, signing setting or system permission was changed.

Neither `SEMITRAX_API_URL` nor `MAPBOX_PUBLIC_TOKEN` was present in the build process. The existing release configuration gate must receive an approved public HTTPS API and usable public display token before a meaningful release build. No invented production endpoint/token was substituted and the gate was not bypassed.

### Audited build foundation

RN 0.85.0; installed RN Gradle plugin catalog AGP 8.12.0; Gradle wrapper 9.3.1; compile/target SDK 36; Build Tools 36.0.0; NDK 27.1.12297006; flexible-page-size CMake opt-in; `useLegacyPackaging=false`; configured ABIs `arm64-v8a,x86_64`; release minification enabled with vendor keep rule. Version code/name: `1` / `0.1.0`. Release is unsigned, uses `com.semitrax.app`, disables cleartext traffic and Metro, and regenerates public environment configuration. Debug uses `.migration.debug`. Dependency compilation and final merged manifests remain unverified.

The vendor directory contains four ABIs, all passing PT_LOAD and GNU_RELRO alignment inspection:

| CoPilot binary | SHA-256 |
| --- | --- |
| arm64-v8a/libcopilot.so | `13505f66cbe66bf2bcbca3bc9d71703af564d47ac368c60883a9f30569e22e0a` |
| armeabi-v7a/libcopilot.so | `cbd41a240e923bbf1cb22b6124f90709cd2dcffb58325596d169a69a71faf46b` |
| x86/libcopilot.so | `a82879c919aa86692d4ab8cb2466781c33705dc1d20979c9ea97056eb00f6c53` |
| x86_64/libcopilot.so | `2d5b89e72720073c5411ce18c921cc79bc760204fcd7c2ed320bb77df7c8e2ba` |

These are supplied binary hashes, **not APK/AAB hashes**. Android's current guidance requires checking packaged ELF load segments, applicable RELRO alignment and APK ZIP alignment, then testing a 16 KB environment. [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes). Read-only ZIP verification is `zipalign -c -P 16 -v 4 <apk>`. [zipalign documentation](https://developer.android.com/tools/zipalign).

### Guarded Windows fallback

The external release kit targets Windows PowerShell 5.1 and defaults to read-only preflight. `-Build` explicitly requests an unsigned production-style `assembleRelease`; no install/sign/upload/deploy task exists. Its repaired guard requires the exact six tracked modifications and five untracked files in section 4, with case-sensitive path/status comparison and SHA-256 pins for all eleven files. It rejects any staged change, missing/extra inventory path, changed pinned bytes, unexpected source, environment/signing/credential file or production configuration change reported by Git. It checks branch, checkpoint and local remote-tracking ref. No broad wildcard allowlist is used.

The user explicitly approved tolerating only the existing `?? test/failures/` status as a protected exclusion. It is never checkpoint content, never traversed or hashed, and any tracked/staged inclusion fails the guard. The kit does not discover ignored local files or scan secret stores; its claim is a guard on the reviewed Git change set plus pinned file bytes, not certification of all host files.

Build mode requires approved configuration; uses a workspace Gradle cache; regenerates release configuration; reruns native/auditor checks; requires a fresh unsigned release APK; records exact path and SHA immediately; checks package ID, target SDK and debug flag; checks ZIP alignment; extracts every `.so` with traversal/duplicate/ABI guards; audits all extracted ELF files plus CoPilot input/output provenance. It restores the prior ignored generated public config in `finally`. No ACL broadening, destructive Git command, production modification or credential-output operation was added. The package-audit companion is unchanged.

The helper adds RELRO checks to the existing ELF auditor. A CoPilot package differing after symbol stripping must match the Gradle release stripped output, while its vendor input must match the pinned hashes. The JSON records this distinction. The script builds APK only: AAB/bundletool and Play-generated split APK acceptance remain separate. Future AAB acceptance must include bundle configuration requesting `PAGE_ALIGNMENT_16K` and inspection of generated deliverable APKs; an AAB alone is not final installed-package evidence.

Read-only validation: parsed successfully by **Windows PowerShell 5.1.26100.9444**, helper `node --check` passed, command/guard paths reviewed, ELF/RELRO logic exercised on in-memory controls and real vendor binaries. Direct `powershell.exe -NoProfile -File ...` was denied with `running scripts is disabled on this system` / `UnauthorizedAccess`. No execution-policy bypass was used. Consequently the complete fallback execution is **not** claimed tested; run it only on a host where local policy already permits reviewed scripts. This policy restriction does not invalidate the successful read-only parser validation.

Repair validation reparsed the updated kit with Windows PowerShell 5.1.26100.9444 (zero syntax errors) and rechecked companion JavaScript syntax. A PowerShell 7.6.5 harness extracted only literal allowlists/hashes using AST `SafeGetValue`, verified the current six tracked/five untracked paths and all eleven hashes, and exercised two positive and fifteen negative path/status comparison controls. Rejected controls cover extra tracked/source paths, production configuration, environment/credential/signing paths, tracked/staged failures, similar directory names, case changes, a missing required file and a staged reviewed file. The release-kit script body was not executed by this harness. This is data/comparison validation and source review, not end-to-end preflight/build execution. Evidence: `release-guard-validation.log` and `release-kit-ps51-parse.log` in `work\phase4-repair`. Historical ELF controls and blocked build evidence above were preserved without rerunning unrelated builds.

## 8. Feature 38 — Android Auto

Application Kotlin/Java, manifest and Gradle configuration contain no CarAppService, Android for Cars navigation category, host session/screen integration or automotive app metadata. The shipped CPIK Java/XML/build source search did not establish Android Auto APIs or integration. This is a source search result, not proof of absent functionality inside every opaque vendor binary.

The installed package and lock-pinned application dependency are `trimble-maps-cpik-react-native-library@10.28.2-497`; its RN dependency matches 0.85.0. Trimble's specific 10.28.2.497 release entry includes a RouteSync fix, but establishes no Android Auto integration entitlement for this app. Do not substitute documentation for another SDK/release. [Trimble 10.28 release notes](https://developer.trimblemaps.com/copilot-navigation/release-notes/v10_28/).

Required from Trimble: written confirmation that this exact CPIK/RN release supports Android Auto; supported library/bridge and sample application; commercial truck/projection licensing and distribution rights; map/guidance/voice/session lifecycle contracts; compatibility with RN New Architecture and target SDK 36; supported head-unit testing matrix. If a different vendor build is required, audit that actual delivery before any integration.

After vendor clearance, application integration still must be implemented and validated under Android for Cars navigation requirements, then exercised on a supported host/head unit. [Android navigation-app integration](https://developer.android.com/training/cars/apps/navigation). No Android Auto service or speculative vendor API was added. Status remains EXTERNALLY BLOCKED.

## 9. Feature 39 — Apple CarPlay

The iOS foundation has an ordinary RN AppDelegate, CoreLocation bridge and unavailable guidance boundary. No CarPlay scene delegate, navigation templates, approved entitlement or linked CPIK iOS framework is present in the inspected project.

Remaining requirements: Apple approval for navigation entitlement `com.apple.developer.carplay-maps`; managed App ID capability; matching provisioning profile and signing identity; supported vendor CarPlay integration for the actual delivered CPIK version; Xcode application/scene integration; successful archive; simulator and real iPhone/head-unit acceptance. Apple requires entitlement approval before provisioning that capability. [Apple CarPlay entitlement process](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements).

No entitlement, certificate, profile, Apple account or credential was fabricated. Apple approval alone would not establish application integration or navigation runtime. Status remains EXTERNALLY BLOCKED.

## 10. Feature 40 — iOS production readiness

| Area | Source evidence and remaining gate |
| --- | --- |
| Project/resources | Existing privacy resource membership now explicit; native sources and bridging header wired; shared ArchiveAction uses Release |
| Deployment/bundle/version | iOS 15.1 matches installed RN minimum; release `com.semitrax.app`; debug `.migration.debug`; marketing version 1.0, build 1; confirm store record/build-number availability externally |
| Privacy manifest | Valid XML; required-reason entries FileTimestamp C617.1, UserDefaults CA92.1, SystemBootTime 35F9.1; tracking false; collected-data array empty. This is a foundation manifest, not an approved complete data inventory or App Store privacy answer |
| Privacy acceptance | Generate the actual archive's aggregate privacy report on Mac; reconcile app/backend and third-party collection, purposes, identifiers, precise location, account/document/dispatch data, retention and tracking with owner-reviewed disclosures. Confirm required reasons correspond to real use. Empty app collection entries do not prove the product collects no data |
| Permissions | Descriptive WhenInUse and Always usage strings; full accuracy required; staged Always upgrade has explicit state; denied/restricted handling |
| Background/location | UIBackgroundModes location; start requires visible app; explicit background request requires Always permission; background indicator enabled; foreground-only tracking stops on background |
| Lifecycle | Manager delegates, event callbacks, main-queue bridge dispatch and invalidation cleanup present; software-simulated fixes rejected; actual OS permission transitions/termination/relaunch remain device tests |
| Network security | ATS arbitrary loads false; local-network allowance exists for development. Shared plist does not replace release endpoint validation. Review actual archive traffic on device |
| Production separation | Configure phase passes `--release` in Release before RN bundling; validates public HTTPS API and rejects private Mapbox token values; release AppDelegate loads bundled JS. Approved public token and endpoint still required |
| Mapbox | `@rnmapbox/maps` 10.3.5; Android native 11.23.1, iOS constraint `~> 11.23.1`; Podfile has pre/post install hooks. Actual Pod resolution/lock and archive are unverified. Installed podspec marks download-token setting deprecated/not required; do not invent a private download credential requirement. Public display token, attribution and privacy review remain |
| CoPilot | iOS autolinking explicitly null; no SDK frameworks/resources delivered or linked. Obtain matching CoPilotIntegrationKit and CPIKReactNative frameworks/resource bundles, or the vendor's supported replacement layout; inspect slices, minimum OS, RN compatibility and embedding/signing on Mac |
| Signing/build | No signing identity/profile/team verified. macOS, supported Xcode/CocoaPods, resolved dependencies, archive validation and physical iOS acceptance required |

No additional safely established iOS source defect was found in this bounded audit. Both Phase-4 changes were retained without rewrite. The release archive, aggregate SDK manifests, actual data collection and Apple credentials cannot be certified on this host. No production privacy-completeness claim is made. [Apple privacy manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).

## 11. Feature 42 — CoPilot readiness and exact external blockers

CoPilot remains **FAIL-CLOSED**. `CopilotRuntime.prepareProvisioning()` returns null and `startNative()` throws `COPILOT_NATIVE_STARTUP_VALIDATION_REQUIRED`. Kotlin/Swift guidance boundaries remain unconfigured. Truck assessment returns `canApply: false`; no partial truck mapping is activated.

Required before enabling navigation:

1. Secure native credential/provisioning provider; actual approved AMS company/external-account or product-key mode. No credentials in JS, logs or report.
2. Verified full-navigation, heavy-truck, region and any RouteSync/Android Auto/CarPlay entitlement applicable to the exact release/license.
3. Licensed installed maps/resources with verified region, year/quarter/version and update handling; network/offline startup policy.
4. Vendor-corrected or natively reviewed/tested startup: pinned Android code uses a null notification small icon and unchecked Activity access. No specific device crash is asserted without reproduction. Do not bind while these risks remain.
5. Successful native compile/link and R8 release acceptance; vendor JNI/reflective models currently have broad `com.alk` keep rules, which are preparation rather than runtime proof.
6. Truck restriction parity and active-profile readback: dimensions/weight units, loaded/gross weight policy, weight per axle, axle count, trailer count/type, hazmat classes, ferry/toll semantics and highway/residential/dirt exclusions. Unsupported fields must not be silently discarded.
7. Correct asynchronous startup/license/map/route/guidance/arrival events, stale-session rejection, stop identity/order, pause/resume/background behavior and error handling on a real device.
8. Real route calculation plus actual maneuver, voice, lane, reroute and arrival session; physical truck-route acceptance. No such session has been accepted.
9. Matching iOS frameworks/resources, native integration and Apple build/signing/device validation for iOS.

### RoutePath ↔ CoPilot authority question — unresolved

**Can CoPilot guide the exact authoritative backend Trimble RoutePath, or must it calculate its own active route?** This audit does not choose an answer.

Pinned source provides `RouteSync.sendManagedRouteJSON`, `sendManagedRouteJSONStopList`, `sendManagedRouteByObjects`, `sendManagedRouteByText` and `sendManagedRouteByBinary`, plus integration/error events. Presence is useful evidence, not proof that a REST RoutePath report/GeoJSON is accepted unchanged. Object/text wrappers specify STRICT compliance with different numeric thresholds; units and guarantees must be confirmed. The binary wrapper writes a full 1024-byte buffer instead of the actual read length, a vendor-source risk if a partial final chunk occurs; that unused entry point remains disabled, not patched speculatively.

Request Trimble's explicit contract for **10.28.2-497**: supported import format/schema and conversion from the actual backend RoutePath response; required license; map/data-version compatibility; coordinate order/precision, stops/leg identity and restrictions; whether import recalculates, snaps or substitutes roads; STRICT compliance meaning and threshold units; deviation/closure/reroute authority; errors when exact compliance is impossible; and sample payload plus device evidence comparing accepted backend path to actual guided road sequence. Obtain a corrected binary wrapper if that transport is selected. A Promise acknowledgement or `onRouteSyncIntegrated` alone is not exact-road equivalence evidence.

## 12. Routing architecture and preserved security/regression evidence

Canonical flow remains:

```text
destination / ordered stops
→ canonical StopPlan
→ Trimble commercial truck routing
→ accepted route
→ Mapbox display
→ CoPilot active navigation only after licensing/runtime verification
```

Trimble is the sole authoritative commercial truck routing provider. Mapbox is approved only for map display/geocoding where currently used, never as a passenger-route fallback. HERE and TomTom are not current SemiTraX services/providers. No HERE routing, TomTom routing, Mapbox Directions or other passenger-routing fallback is authorized or introduced. RouteSync availability does not authorize a different route authority. The existing Trimble routing implementation is unchanged.

**Legacy HERE audit classification: REACHABLE.** `apps/api/src/server.ts` still mounts authenticated `GET /location/timezone`, `GET /places/search` and `POST /places/corridor`. They call `resolveHereTimeZone`, `searchHerePlaces` and `searchHerePlacesAlongRoute`, respectively; the last delegates to `searchHerePlaces`. The timezone/place implementations can call HERE APIs when configured, and the place endpoints retain HERE response labels. These are reachable legacy non-routing paths, not dead code and not an approved current-provider designation. Actual production configuration, traffic and upstream success are UNVERIFIED. No legacy HERE API code was removed or changed during this repair; retirement requires separate scope/review.

The retained `HereRouteProvider` always throws `HERE_ROUTING_DISABLED`; the retained Mapbox routing compatibility boundary always throws `MAPBOX_ROUTING_DISABLED`; alternative-provider comparison is disabled. Current Admin source no longer presents HERE/TomTom as active services: deliberate historical filters and tests remain. Legacy code comments do not override the intended architecture above.

The user's verified prior evidence is carried forward, not represented as rerun here:

| Prior evidence at this checkpoint | Preserved result |
| --- | --- |
| React Native | 316 tests PASS; TypeScript PASS; lint PASS |
| API | 188 tests PASS; zero skipped |
| PostgreSQL 16 isolated rehearsal | 10 migrations, schema parity, upgrade/data preservation, foreign keys and rollback PASS |
| Phase-3 security harness | PASS; prior report records 98 permission decisions and 68 mounted HTTP checks |
| Four targeted Phase-3 reproductions | PASS |

The complete Phase-4 tree DOES change Admin/API source and adds Admin/API provider tests, as listed in section 4. Repair validation therefore reran the 28 Admin tests, 62 focused API tests, both provider-specific suites and both builds. RN business logic, migrations, security middleware and routing implementation remain unchanged; the unrelated full RN/API/database suites were not rerun, and their older results above remain historical. Preserve dispatch pickup as an ordered required stop; conflict review before document retry; clean new-document defaults; and stable pending-create idempotency across remount. Authentication, sessions, password recovery, RBAC, fleet/driver isolation, document privacy, dispatch authorization, audit logs and billing boundaries are unchanged. Phase-2 malformed-DOT fail-safe, explicit corridor failures and ahead-of-route POI filtering-before-truncation remain unchanged. Phase-1 truck-profile safety, ordered StopPlan and Trimble authority remain unchanged.

Source of historical evidence: user handoff and `docs/SEMITRAX_PHASE3_FEATURES_26_37.md`, including its post-review repair evidence. No new database/production connection was opened.

## 13. Feature 43 — physical road-test checklist

**Status: NOT STARTED. Every row below is pending, not a result.** Record PASS / FAIL / BLOCKED / NOT RUN, timestamp, tester, exact artifact SHA, backend release ID, sanitized evidence reference and issue ID for each item. A disabled feature is BLOCKED, never PASS.

### Prerequisites and safety

- [ ] Record Samsung model, OS/security patch, actual OS page size, app version/build/hash, truck/trailer configuration, map/provider versions, test route and start/end time.
- [ ] Obtain authorized device-install/test scope separately; this continuation installs nothing.
- [ ] Qualified driver and separate observer; configure and document while safely parked. Use an approved legal route and safe stopping points. Follow posted signs and local restrictions over software.
- [ ] Review known bridge/height/weight/hazmat restrictions in advance. Assess prohibited alternatives using parked planning review or an approved closed-course method. Never intentionally drive a truck onto a prohibited/unsafe road to test rejection.
- [ ] Set abort criteria: unsafe instruction, incorrect truck profile, stale/unknown location presented as valid, driver distraction, overheating, lost safe guidance, or inability to stop navigation safely.

| Test | Required acceptance/evidence |
| --- | --- |
| Samsung cold/warm startup | Correct build/configuration, no unintended guidance/service start; permission denials explained |
| GPS acquisition | Time to first fix, precise-location permission, accuracy/timestamp and correct road position; stale/mock data rejected |
| Truck profile | Actual dimensions, loaded/gross/axle weight, axle/trailer count, hazmat and avoidances reviewed; correct verified revision used |
| Trimble route | Authenticated authoritative route; accepted identity/geometry displayed accurately on Mapbox; provider failure stays explicit |
| Pickup and ordered stops | Pickup retained as required first assigned stop; all intermediates/destination in order; no silent omission/reordering |
| Alternatives | Only valid authoritative alternatives; compare stop coverage/restrictions; acceptance changes intended route explicitly |
| Known truck/weight restrictions | Parked review confirms avoidance of prohibited height/width/length/weight/axle/hazmat roads; no unsafe live experiment |
| Maneuver progression | Observe actual navigation events, position correlation and no stale/backward/duplicate progression; BLOCKED until real guidance available |
| Voice and lane guidance | Correct timing/content/volume/lane advice for real maneuvers; distinguish missing native capability from tested failure |
| Off-route rerouting | Only safe/legal planned deviation or closed course; new route preserves remaining ordered stops and truck restrictions; authority explicit |
| Arrival | Correct intermediate/final distinction, no early completion on parallel roads; stop IDs match; final termination correct |
| GPS loss/recovery | Safe covered/controlled condition; stale location not promoted; recovery resumes without route/stop corruption |
| Network loss/recovery | Safe parked/controlled transitions; honest unavailable state for online functions, no passenger fallback; retry/idempotency preserved |
| Background/foreground | Explicit tracking behavior respected; foreground-only mode stops; authorized background mode and lifecycle checked |
| Screen lock/unlock | Position/guidance behavior, notification state, no duplicated session or listener |
| Phone/audio interruption | Call/audio-focus interruption and recovery; guidance state consistent; perform safely with observer |
| Route restart/app restart | No silent unsafe auto-start; verified truck/stop plan preserved; stale callbacks rejected |
| Active dispatch | Scoped assignment review, pickup order, accept/reject, revision conflicts and later updates; no automatic navigation |
| POIs | Ahead-of-route/corridor relevance, meaningful category, correct side/access where known; no off-corridor truncation bias |
| Weather | Route-correlated forecast/alerts and timestamps; missing/stale feed explicitly unavailable |
| Traffic/closures | Provider/source/time visible; closures do not cause an unauthorized routing provider switch |
| 511/DOT | Fresh valid regional data; malformed/outdated provider snapshot fails safely; no fabricated closure certainty |
| Parking/weigh data | Source/freshness and uncertainty; safe access assessed before turn; no assumed parking space or open scale |
| CoPilot when licensed | Exact SDK/maps/license evidence, startup, profile readback, accepted route relation, actual native maneuver/voice/lane/reroute/arrival |
| Android Auto when supported | Vendor-supported build/license, host/head-unit connect/disconnect, driver-distraction rules, route/audio/state continuity |
| Long-duration navigation | Approved multi-hour session; periodic memory/location/event observations, no drift, stop loss or duplicated sessions |
| Battery | Start/end percentage, charging state, brightness/network/background modes, duration and drain rate; compare controlled baseline |
| Thermal behavior | Ambient/device temperature observations, throttling/warnings and safe abort; do not force unsafe overheating |

Conclude with unresolved issue severity, sanitized logs, observer sign-off and explicit release recommendation. A physical Samsung running 4 KB pages does not establish 16 KB runtime compatibility; record a separate verified 16 KB test environment. CarPlay requires its own iPhone/head-unit acceptance.

## 14. Feature 44 — production backend readiness

Source audit scope: `apps/api/src/server.ts`, configuration modules, security middleware, billing gates, `render.yaml`, and `docs/RELEASE_RECOVERY.md`. Production was not queried or changed.

| Area | Existing source foundation | Remaining release requirement |
| --- | --- | --- |
| Entry/configuration | Package starts `dist/server.js`; production startup validates DB URL, JWT secret, token lifetimes, public HTTPS origin, exact CORS origins and password recovery | Confirm actual running service uses this entry/build; supply reviewed real values; do not deploy legacy/root API by mistake |
| HTTPS/CORS | Public HTTPS configuration enforced; explicit CORS allowlist; no wildcard; API binds behind hosting TLS | Validate real TLS/proxy behavior and approved Admin origins; local source does not prove deployed configuration |
| Secrets | Server-side provider keys, JWT and recovery credentials; native public config rejects private Mapbox token | Approved secret store/access/rotation; no credential values read or copied in this audit |
| Recovery setup | Production requires RESEND_API_KEY, PASSWORD_RESET_FROM_EMAIL and PASSWORD_RESET_BASE_URL | `render.yaml` does not supply these; service owner must configure verified sender/key and approved reset page before rollout; startup correctly fails closed if absent |
| PostgreSQL/migrations | Blueprint prepares PostgreSQL 16 and pre-deploy migrate deploy; preserved isolated 10-migration evidence | Confirm intended actual database, backups/retention/RPO/RTO and rollback compatibility; never reset production |
| Backup/recovery | Written recovery runbook and isolated migration rollback evidence | Actual backup availability/retention and restore drill against an approved isolated recovery target, including measured recovery time; migration rollback is not production disaster-recovery proof |
| Health/readiness | `/health` performs DB SELECT 1 and returns 503 on failure; exposes contract/provider configuration states | Live probe/timeout/alert validation; provider configured booleans do not prove licensed or healthy upstreams |
| Logging/redaction | Generated request IDs; method/status/duration; event allowlist; sanitized outward errors | Validate hosting log access, retention/redaction, failure alerts and operator escalation; no production log evidence claimed |
| Monitoring | Admin health/analytics foundation and HTTP metadata | Owner-approved availability/latency/error/DB/provider alerts and delivery tests; no monitoring subscription/config change performed |
| Rate limiting | Bounded fail-closed per-process IP buckets: global 120/min and auth 20/min | Validate proxy/client-IP topology and health-probe interaction before deployment. No trust-proxy configuration is set; proxied clients may share a bucket. Distributed/multiple-worker enforcement is not implemented. Do not enable broad proxy trust without topology evidence |
| Rollback | Runbook requires schema/client compatibility review | Known prior binary, migration compatibility and operational rollback rehearsal/owner; no automatic cross-schema rollback |
| Immutable release identity | `/admin/application` returns APP_VERSION and APP_BUILD_SHA; SHA defaults to null if not supplied | Set actual build SHA/version in release process, record artifact and migration hashes. Blueprint does not automatically inject APP_BUILD_SHA; this is not yet a reproducibly identified production release |

These are explicit production acceptance/configuration gates. Local guards are not bypassed and the report does not certify the deployment design at scale. Where topology, ownership or live service evidence is missing, no speculative production change was made.

Billing remains disabled by default and Blueprint. Source accepts only disabled/test modes, rejects live Stripe keys in test mode, and protects manual grants behind test billing. Production Google Play/Apple billing verification is not implemented/accepted. Paid entitlement must come from verified provider state; no local/mock purchase or administrator test grant may establish production entitlement.

## 15. Google Play readiness

**NOT READY.** Target SDK is configured to 36, matching the current ordinary mobile new-app/update requirement, but the actual merged artifact is not built. [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878).

Remaining: approved production API/display token; successful release APK/AAB; complete packaged ELF/RELRO/ZIP and split validation; secure upload key and Play App Signing configuration with known certificate fingerprints; real store package record and unused/increasing version code; physical acceptance; reviewed permissions/foreground location and notification behavior; privacy policy, accurate Data safety collection/sharing/retention answers, account-deletion flows applicable to the product, store metadata/screenshots/content rating/review access; verify current Play requirements in the actual account at submission. No store credentials or signing keys were invented. The unsigned fallback APK is not upload/distribution readiness.

## 16. App Store readiness

**NOT READY.** Remaining: Apple developer/team access, registered `com.semitrax.app`, matching certificates/profiles and approved capabilities, a unique version/build, actual Xcode/CocoaPods archive, privacy report and required-reason/SDK checks, physical iOS acceptance, truthful App Privacy details, account-deletion and support/privacy information, store metadata/screenshots/age-rating/export-compliance answers and reviewer access. Validate the accepted Xcode/SDK version at submission against Apple's current requirements; no Windows static check establishes that. [Apple submission requirements](https://developer.apple.com/app-store/submitting/).

CarPlay and CoPilot remain unavailable until separately licensed/integrated/accepted. No App Store Connect changes, uploads or submissions were made.

## 17. Findings by severity and ownership

Severity here distinguishes review of the retained source patch from permission to release an unfinished integration. External/vendor findings are not waived or counted as working features.

### BLOCKER

- **External build host:** release wrapper lock-path and network-permission failures; no final artifact.
- **External commercial/runtime:** CoPilot secure provisioning, entitlements, maps, supported truck parity and real runtime acceptance.
- **External platform:** Android Auto supported pinned integration and Apple CarPlay approval/integration; macOS/Xcode/signing/store access.
- **External acceptance:** no road/device test; no production operating/store evidence.
- **Internal repair review blockers:** none identified in the repaired check, reconciled eleven-file inventory and external kit guard.

### HIGH

- **Vendor integration gate:** null notification icon/unchecked Activity and unsupported safety-profile fields must be resolved before enabling CoPilot; fail-closed application guard remains intact.
- **Vendor RouteSync gate:** exact backend-path guidance and route-authority semantics unresolved; binary wrapper partial-chunk issue requires vendor repair if that unused transport is chosen.
- **Release/operational gates:** real backups/recovery, production credentials, signing and native/device acceptance are not evidenced. They prevent release, not inspection of this patch.
- **Internal review defects remaining:** none established in the retained patch by this bounded audit; no known active safety defect is waived to obtain a PASS.

### MEDIUM

- **Store/owner validation:** foundation privacy manifest and current metadata are not complete privacy acceptance; reconcile against actual archive/production data practices.
- **Operations validation:** process-local rate limits, proxy identity, health probes, monitoring and release SHA injection need explicit production review and evidence before deployment.
- **Tooling limitation:** fallback fully parses on PS 5.1 but policy blocks script execution here; no end-to-end fallback success claimed.
- **MEDIUM 1 — RESOLVED:** this report now covers all eleven files, actual Admin/API changes and validation, intended provider architecture and reachable legacy HERE code.
- **MEDIUM 2 — RESOLVED:** the standalone kit guard now pins the exact eleven-file tree, tolerates only the user-approved protected untracked directory exclusion and rejects other paths/statuses. Kit artifacts stay outside the checkpoint.
- **Internal MEDIUM defects remaining:** none identified. Production preparation gaps remain explicitly open; SAFE TO REVIEW is not SAFE TO DEPLOY.

### LOW

- **LOW — RESOLVED:** the native privacy assertion now validates actual PBX objects and membership, including application-target attachment. All 28 negative and 3 positive controls pass; comment removal no longer causes a false failure.
- **Internal LOW defects remaining:** none identified.

Internal repair findings: **BLOCKER 0 / HIGH 0 / MEDIUM 0 / LOW 0**. The external release gates above remain open and are not counted as newly introduced repair defects. The report does not claim exhaustive security certification, a fresh dependency advisory audit or absence of undiscovered defects.

## 18. Exact final git status and stop-for-review disposition

```text
## codex/semitrax-react-native-prelicense...origin/codex/semitrax-react-native-prelicense
 M apps/admin/src/App.tsx
 M apps/admin/src/types.ts
 M apps/api/src/modules/analytics/adminAnalytics.service.ts
 M apps/api/src/server.ts
 M apps/mobile-react-native/ios/SemiTrax.xcodeproj/project.pbxproj
 M apps/mobile-react-native/scripts/check-native.cjs
?? apps/admin/src/providerHealth.ts
?? apps/admin/test/provider-health.test.cjs
?? apps/api/src/modules/analytics/providerHealth.ts
?? apps/api/test/providerHealth.test.ts
?? docs/SEMITRAX_PHASE4_FEATURES_38_44.md
?? test/failures/
```

HEAD remains `423d152589da362b4615f355801acd9c5dc8c2a4`; the Xcode project and all eight Admin/API paths retain their pre-repair bytes. Only the native check and this report changed in the repository during repair. There are no staged changes; final `git diff --check` passes. No reset, commit or push. `test/failures/` remains untouched and untracked, excluded from the eventual checkpoint.

| Disposition | Result |
| --- | --- |
| Execution environment works | YES — initial gate and local validation |
| Complete eleven-file inventory reconciled | YES |
| Affected validation passes | YES — native/codegen and 28 negative/3 positive controls; historical CoPilot operational nonzero exit remains an external gate |
| Admin validation completed | YES — 28 tests, separate 7 provider tests, TypeScript/Vite build |
| API validation completed | YES — 62 focused tests, separate 7 provider tests, TypeScript build |
| Phase-4 report reconciled | YES |
| Release-kit guard repaired | YES — exact paths/statuses and eleven file hashes; protected exclusion explicitly approved |
| Unresolved identified internal BLOCKER/HIGH/MEDIUM in reviewed patch | NO |
| Production modified | NO |
| Deployment performed | NO |
| Device installation performed | NO |
| Physical road test performed | NO |
| Commit/push performed | NO |
| SAFE TO REVIEW | YES |
| Ready for production/store release | NO |

**STOP FOR REVIEW.** Android Auto, CarPlay, CoPilot licensing/runtime, physical acceptance, Android build-host access, macOS/Xcode and store credentials remain external gates.
