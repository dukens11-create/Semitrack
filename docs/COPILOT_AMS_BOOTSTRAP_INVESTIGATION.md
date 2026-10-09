# Restored SemiTraX: AMS startup investigation — 2026-10-09

## Device evidence and limits
The Samsung screenshot at 07:05 America/Los_Angeles shows native startup completed and license verification failed with COPILOT_AMS_IDENTITY_MISSING. This means the SDK's current identity lacked an asset or company, not that Trimble rejected a license. Blank input fields after Save are intentional UI clearing; they do not prove encrypted setup was erased.

This environment cannot access Samsung USB/ADB or its native logs. The exact phone-side authentication result remains unverified. The corrections below address reproduced integration faults, not a claimed complete device acceptance.

## Reproduced integration faults
1. The old credential hook called LicenseMgr.GetActiveAMSUser before providing the credentials used for login, swallowed every exception, and returned null. The shipped 10.28.2-497 SDK has a null native license-manager pointer before initialization. Executing that query against the real JAR before initialization reproduces NullPointerException. Trimble documents the active-user query as accurate only while CoPilot is running.
2. LicenseListener.registerHook writes a single static hook slot. The vendor React Native LicenseListener constructor installs its own default hook with empty credentials. A real-JAR regression demonstrates that this overwrites the host hook. Whether overwriting happened in this phone session is not established.
3. The host did not observe onLicenseMgtLogin's LicenseActivationResponse. The React Native lifecycle ignored callback payloads to protect IDs, so server, assignment and device-limit failures could collapse into a missing-identity message.
4. The previous sticky identityMismatch flag is already removed; that repair alone did not correct the cold credential handoff.

## Corrections
- Snapshot the encrypted, immutable device assignment natively before binding.
- On cold startup, supply that assigned identity via the documented credential hook without calling the unsupported active-user query.
- When the SDK is running, preserve any observed different account or failed identity query; do not substitute a different assignment.
- Reclaim the global credential hook immediately before every service bind, after vendor module construction.
- Register a native login observer, retain only the SDK enum response, and never retain or emit callback account IDs.
- Separate a missing hook, query failure, account conflict, credentials supplied awaiting response, response timeout, and each fixed SDK login error.
- Retry temporary server/readiness failures within the existing bounded window. Stop automatic retries on invalid assignment, device limit, expired/no active license, or observed identity conflict.
- Keep identity, Full Navigation, Heavy-Duty Truck and actual selected-map inventory verification required before rendering the native offline map. Keep unverified truck guidance gated.

No logout, updateCreds, deactivation, data clear, uninstall, map deletion or administrator assignment mutation was added. The bootstrap uses the immutable assignment explicitly saved for this app. It follows Trimble's normal authentication hook; it does not establish that an unknown cached account on a different app shares this assignment.

## Verification
- 59 React Native suites / 898 tests passed, including bounded server recovery, non-retryable assignment failures and safe diagnostic text.
- 14 executable JVM assertions against the shipped CPIK JAR and production credential policy passed, including the pre-initialization exception, zero cold identity queries, matching/case-equivalent identity, preservation of a different running account, and global-hook overwrite/reclaim.
- Typecheck, lint, native wiring and 9 ELF page-size tooling tests passed.
- Android Java compilation/APK packaging are verified separately by the GitHub build associated with the repair commit.

These checks do not authenticate with Trimble or prove map display on Samsung.

## Samsung acceptance
Update the same restored package without uninstalling or clearing data. Cold-launch SemiTraX with internet and precise location; keep it visible on Wi-Fi. Retry saved setup once if needed. Capture the setup stage if it remains blocked.

Required evidence:
1. Active SDK identity matches the saved assignment and both licensed features pass.
2. California download starts automatically only if actual inventory lacks it.
3. SDK installed inventory confirms California; native CoPilot map is visible.
4. A second cold launch restores setup and maps.
5. A specific SDK login error, if any, is handled according to that response. A server/device-limit/assignment issue cannot be claimed fixed by a green build.
6. Truck profile, route coverage and live guidance require separate native acceptance; never bypass their gates.

## Primary references
- Authentication hook: https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/how-to-guides/authentication/
- Active-user and pre-start login requirements: https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/api-functions/licensemgr/
- Local pinned vendor source: LicenseListenerModule.java and CPIK 10.28.2-497 licensing classes.
