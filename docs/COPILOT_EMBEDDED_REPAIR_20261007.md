# Embedded CoPilot repair — 2026-10-07

## Source and scope

Repository: dukens11-create/Semitrack. Branch: codex/rn-android-test-apk.
Base: 5c7e8a629698842b7a5d1a6d7afe1e309197bcac (remote reconfirmed before integration).
Isolated worktree: C:/Users/duken/Documents/Codex/copilot-engine-repair.
The older backend-repair working tree and its uncommitted work were not changed.
React Native 0.85.0; CPIK 10.28.2-497; Kotlin 2.1.20; Gradle 9.3.1; NDK 27.1.12297006 remain pinned. Existing CPIK patch-package patch is unchanged.

## Diagnosis

1. The banner previously owned a separate lifecycle backed by a provisioning function that always returned no provisioning. It could not reflect the actual embedded setup evidence.
2. Securely saved device IDs were loaded into the setup form but did not restore the embedded engine automatically at application startup.
3. Native onHostPause unbound the service and removed observers. Backgrounding, permission dialogs and activity changes could interrupt the setup/download observation path.
4. An already-running service need not replay onCPStartup when rebound. The new host also queries the real CopilotMgr.isActive() result.
5. The first-map gate treated onReadyToDownloadInitialMapData as mandatory even for AMS-based device licensing. Trimble documents this callback in the product-key/region-upgrade flow. That documentation does not establish it as a universal device-AMS prerequisite. This is a contract interpretation, not proof of this device's download entitlement.
6. Previous first-map calls used overwrite=true, which can replace another overwrite download. The repair uses additive requests only. Manager-busy failures are now bounded, rather than requiring repeated taps or an indefinite callback wait.

The exact internal reason for the Samsung's historical FAILURE_MANAGER_BUSY is not proven locally. A missing callback alone does not establish an entitlement failure or an SDK defect.

## Readiness and download behavior

- One application-wide EmbeddedSession restores credentials from the existing device-only Keychain service. Automatic startup/foreground checks never prompt for location again or rewrite saved credentials. Manual setup alone can request missing permission.
- Concurrent startup attempts share one promise. Background results are invalidated. Foreground return rechecks the service and licenses. An unanswered native call times out after 16 seconds; startup polling is bounded to 30 seconds between calls.
- Existing saved identity cannot be silently replaced by different entered IDs. No credential is embedded, logged, copied to another customer's license or stored in the session snapshot.
- AMS authorization requires a connected, started engine, licensing-ready, matching active AMS company/device, full-navigation and heavy-truck entitlements, and the selected region in the current licensed list. The callback is still recorded as evidence; it is never hardcoded to true. The SDK remains authoritative for accepting/rejecting the actual request.
- Selection and transaction guard are committed to private app preferences before the SDK mutation. At most three requests are made per user-selected transaction, with 15/30-second backoff for manager-busy or invalid-connection responses. Duplicate selection cannot reset the budget.
- Unknown outcomes and existing/downloading/paused transactions never trigger a replacement download. A stalled pending transaction remains guarded after ten minutes and reports an actionable timeout. A lack of authorization reports a readiness timeout after 90 seconds of eligible polling. No timer runs provider route requests.
- Actual installed inventory must contain exactly one matching licensed package with a valid year, quarter and nonempty version before selected coverage is reported installed. Callback completion, downloaded bytes, license count and route previews are not installation proof. Malformed/duplicate inventory is rejected. A later inventory gap cannot silently re-download a completed transaction.
- Explicit pause/resume/cancel remains available. No deleteMap operation was introduced. Existing map versions must agree before adding coverage. Downloads use the existing Wi-Fi-only SDK configuration.
- The normal embedded setup no longer offers the standalone-app activation URL. Banner and route-start explanation consume the same embedded state. Native/query failures clear stale readiness evidence.

## Guidance / truck restrictions: still blocked

The pinned public VehicleRoutingProfile/VehicleDimensions API exposes dimensions, total weight and weight-per-axle, but no axle-count or trailer-count setter. The separate legacy TruckRoutingProfile/TruckDimensions API does expose numAxles and a 53-foot-trailer flag. That flag is not trailer count, and the legacy type is not proof of complete current-profile restriction parity. The existing exhaustive CopilotTruckProfile assessment and NativeGuidanceAdapter fail-closed boundary remain intact; this finding must not be presented as an absence of axle support in every SDK API. Other unsupported avoidance, trailer and hazmat combinations also remain blocked.

No partial truck profile was applied to the active engine. Truck-safe native route handoff, full route-area coverage, maneuver/voice/progress callbacks and device acceptance are not complete. Turn-by-turn remains disabled. Trimble must confirm a supported representation for every mandatory restriction (or supply a supported SDK contract) before that adapter can be activated. Recognized heavy-truck licensing does not resolve these gaps.

Trimble backend routing, OverrideRestrict=false, dimensions/weight/axles/trailer/hazmat propagation, warning rejection, geometry/stop validation and no-passenger-fallback behavior were not changed.

## Regression evidence

- Full RN suite: 908 passed / 0 failed / 0 skipped, 58 suites.
- 25 new RN cases cover restoration, lifecycle, concurrency, timeouts, credential preservation, stale evidence, map inventory and UI transaction access.
- Native MapDownloadPolicy: 20 executable Java assertions, including consent, bounded retries, duplicate selection, ambiguous outcomes, cancellation, stall handling and installed evidence.
- TypeScript typecheck: PASS. ESLint: PASS, zero warnings.
- Native wiring: PASS. Page-size tool regression: 9 passed.
- Android release compilation/package: PASS (Gradle BUILD SUCCESSFUL, 5m 21s). Passing tests/build is not native/device acceptance.

## Final APK and static audit

- Artifact: `C:/Users/duken/Documents/Codex/copilot-artifacts/semitrax-copilot-20261007-release-unsigned.apk`
- Size: **205,863,870 bytes**.
- SHA-256: **3D92F21D8B61B709EDD6B4FBDC6674C1D6E92C4C4C5AE3CB093D97C83946BDC4**.
- Package `com.semitrax.app`, versionName `0.1.0`, versionCode `1`; release is not debuggable.
- ABIs: arm64-v8a and x86_64; 17 libraries each, 34 total. Both contain libcopilot.so.
- ZIP CRC integrity: PASS. Final APK zipalign `-c -P 16 -v 4`: PASS.
- PT_LOAD: 34/34 PASS. GNU_RELRO writable-overlap/layout: 34/34 PASS.
- GNU_RELRO end-address arithmetic: **26/34 remain flagged**. No suppression or vendor patch was applied. This artifact has not received 16 KB runtime acceptance.
- Unsigned: apksigner verification fails as expected with missing signing manifest; no signing certificate is present. It is not installable until signed with the existing compatible certificate. The historical Samsung certificate mismatch has not been resolved by this task.
- The source manifest matched all 17 reviewed files after building, before this report was updated. The compiled DEX contains the new AMS readiness, identity verification and map-timeout markers.
- Vendor input files and existing patch are unchanged. Packaged libcopilot.so files exactly match Gradle's normal stripReleaseDebugSymbols output, not the original full files: 228 bytes (arm64) and 316 bytes (x86_64) differ outside PT_LOAD segments. **All loadable segment bytes are identical to the vendor originals**; no hex-edit or vendor behavior change was made. Provenance is recorded in `copilot-binary-provenance.json` beside the APK.
- Detailed per-library data: `elf-audit.json`; ZIP evidence: `zipalign.log`; integrity: `apk-integrity.json`, all beside the APK.

The existing Android release configuration was retained. Environment-only build wrappers used short drive aliases and canonical Metro working-directory resolution to handle Windows path/JAR access restrictions. They do not change application source, pinned versions, signing, SDK behavior or ACLs. No source was copied over the older working trees.

## Changed files and integration

All code paths below are relative to `apps/mobile-react-native/`:

- `src/services/copilot/EmbeddedSession.ts` (new)
- `src/services/copilot/EmbeddedSetup.ts`
- `src/services/copilot/MapDownloads.ts`
- `src/app/AppRoot.tsx`
- `src/components/CopilotStatus.tsx`
- `src/components/CoPilotDeviceSetup.tsx`
- `src/components/CoPilotMapDownloads.tsx`
- `src/screens/PlanningScreen.tsx`
- `android/app/src/main/java/com/semitrax/nativebridge/CoPilotSetupModule.java`
- `android/app/src/main/java/com/semitrax/nativebridge/CoPilotMapsBridge.java`
- `android/app/src/main/java/com/semitrax/nativebridge/MapDownloadPolicy.java` (new)
- `__tests__/embedded-session.test.ts` (new)
- `__tests__/embedded-copilot-setup.test.ts`
- `__tests__/copilot-map-downloads.test.tsx`
- `scripts/MapDownloadPolicyTest.java` (new)
- `scripts/check-copilot-policy.cjs` (new)

The seventeenth file is this report. All changes are preserved in the working tree of `codex/rn-android-test-apk`, based on the reconfirmed remote head above. **Local Git metadata remains blocked:** Git cannot create `backend-repair/.git/worktrees/copilot-engine-repair/index.lock` (Permission denied), including after an explicit filesystem write grant. No local files were staged or committed. No ACL changes were made to work around access problems. The user subsequently authorized publication and signing: the reviewed 17-file repair is being published through the authenticated GitHub connector, preserving the blocked local worktree. The branch update triggers the existing Android test APK workflow. Publication/run/signing evidence is recorded separately after completion. No installation, provider route request, production deployment or license activation is part of publication. Turn-by-turn remains gated.

## Controlled device acceptance (not executed)

1. Verify artifact SHA, signature compatibility with the installed app and package before any update. Use the matching existing certificate only; never uninstall to work around a mismatch. No signing/installation was performed by this repair task.
2. Cold-launch on the assigned device with its existing secure settings. Confirm automatic engine startup, current AMS identity/licensing, no duplicate permission dialog and no standalone CoPilot launch.
3. Open Details; choose appropriate licensed coverage once on Wi-Fi with sufficient storage. Record actual response, attempt count, progress, installation and final installed inventory. Do not share IDs or unredacted vendor logs.
4. Test a temporary connection loss and return. Observe no more than three busy/connection retries for the selection. If a request is accepted or its outcome is unknown, verify no replacement request occurs. A stalled transaction must show a timeout rather than claim readiness.
5. Close/reopen the panel, background/foreground repeatedly, rotate where supported, then force-stop/relaunch. Verify saved identity, selected coverage and installed maps survive; startup/checks do not duplicate active downloads.
6. Confirm malformed/unavailable inventory cannot show maps ready. Match selected package/version to the SDK's actual inventory. Installed selected coverage alone is not proof that an arbitrary truck route is covered.
7. Confirm Start Navigation remains gated for the unresolved truck integration. Do not run turn-by-turn or claim success from a preview or recognized license.
8. Inspect sanitized startup/native logs for crashes, linker errors, service disconnects and CPIK callback failures. If manager-busy persists, send Trimble the pinned version, request type, response code and redacted timing/inventory evidence; ask whether that device-AMS entitlement supports additive map downloads and which readiness event it guarantees.

## Primary references

- [Trimble LicenseMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/license/): product-key readiness flow and active AMS identity APIs.
- [Trimble MapDataMgr](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/mapdatamgr/): licensed vs installed inventory, additive/overwrite behavior, Wi-Fi policy and request responses.
- [Trimble hooks and callbacks](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/hooks-and-callbacks/).
- Installed pinned cpik.jar and vendor Java bridge sources, inspected read-only; no vendor binaries modified.
