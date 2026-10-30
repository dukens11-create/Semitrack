# SemiTraX application audit — 2026-10-30

This is an evidence-based audit of the current repair branch and observed deployed services, not a certification that every feature works. No driver identifiers, saved truck values, credentials, or location data are included.

## Confirmed blockers and corrections

| Priority | Area | Finding | Required correction / acceptance |
|---|---|---|---|
| P0 | Native truck compatibility | Current StandardTruckNavigation mode accepts only a verified single 53-foot dry van/reefer, five axles, one trailer, supported dimensions/weights, no hazmat, and representable avoids. A valid server profile may still be incompatible. | Show compatibility before Start; retain actual specifications. Broader equipment requires verified native SDK mappings, not removal of guards. |
| P0 | Axle weight UX | Editor called maximum loaded axle-group weight optional although current native mode requires it. | Label/help corrected on repair branch. Enter measured group weight; do not divide gross weight by axle count. |
| P0 | Profile activation | Server verification and device active selection are distinct. A transient reload failure invalidates the active selection. | Reproduce authenticated device failure; distinguish load, save, verify, and refresh stages. Preserve verification and revision checks. |
| P0 | Misleading connection errors | Profile UI previously treated retryable HTTP failures as loss of connection. | Repair branch distinguishes HTTP 429, HTTP 5xx, and status 0. Timeout/session-change/cancellation should receive further specific messages. |
| P0 | Native guidance | Map rendering, receiving GPS, setup readiness, and preview mileage do not establish active native guidance. | Require confirmed destination handoff and native guidance callbacks; test Start, pause, resume, end, changed profile, and cancellation on Android. |
| P1 | Voice availability | Voice panel was reachable only after active-map entry. | Repair branch exposes voice in pre-navigation engine settings. Verify UI on device. |
| P1 | Voice hangs | Speech bridge promises had no response deadline; a lost native callback could lock controls indefinitely. | Added 10-second bounded waits with no automatic native-command replay. Regression tests cover read/write stalls, mute protection, and timer cleanup. Audible output remains unverified. |
| P1 | Unsupported avoids | New-profile defaults enable residential/dirt-road avoids which current native mode cannot enforce. | Explain this conflict in the editor before activation. Do not silently disable required restrictions. |
| P1 | Planner Start | startNavigation silently returns if route or plan disappears. | Surface a route-expired / replan message and test the race instead of leaving an apparently inert button. |
| P1 | Route recalculation | Planner menu explicitly reports live rerouting unavailable in its active-session path. | Audit native rerouting callbacks separately from planner recalculation; confirm route revision, truck restrictions, and updated instructions on device. |
| P1 | Satellite | Planner satellite action explicitly reports unavailable. | Hide/disable with a capability explanation or implement a licensed supported imagery source. Do not advertise parity with the separate CoPilot consumer app. |
| P1 | Offline address search | Current address search remains Mapbox-based; native offline adapter is absent. | Implement against the licensed SDK or explicitly mark search as online-only; test airplane mode. |
| P1 | Offline coverage | Installed region/setup readiness does not prove coverage for an entire trip. | Check required route regions and storage, interrupted download/resume, and guidance after network loss. |
| P1 | Routing health | Admin can report DEGRADED for missing/stale routing health evidence; this alone is not proof of provider outage. | Obtain a fresh authenticated route result and inspect sanitized provider failure code if it fails. |
| P1 | Dependency security | Production npm audit reported eight dependency findings, including one critical. | Apply compatible patched dependencies, rerun tests and audit; review major-version-only fixes separately before deployment. |
| P2 | Traffic / parking / fuel / weigh status | These use separate provider and coverage paths; CPIK readiness does not activate them all. | Verify each provider, entitlement, freshness and unavailable UI independently. |
| P2 | ELD | Live health response reports ELD encryption not configured. | Complete approved provider configuration before advertising connected ELD functionality. |
| P2 | Purchases | Live billing mode is disabled; Google Play and Apple billing report not configured. | Complete sandbox purchase, restore, entitlement and webhook verification before paid launch. |
| P2 | Browser app | Existing admin is web-based; React Native driver app has no web build script. | A driver web client is separate implementation work. Browser tests cannot certify native Trimble/GPS/audio. |
| P2 | Deployment alignment | API deployment is manually controlled and is older than the repair branch. | Compare intended backend changes and migrations to deployed commit; do not deploy the entire mobile repair branch without backend review. |
| P2 | Test coverage | Database integration tests need an isolated database; local private Trimble SDK is absent. | Run database integration suite in isolation and private SDK checks in configured CI. |
| P2 | Release identity | Test package uses fixed version 392 across updates. | Use clear per-build identity and a monotonic release version for distribution; preserve installed signing identity, enrollment, and maps. |

## Verification performed

- Mobile TypeScript and ESLint checks passed.
- Mobile Jest: 72 suites, 981 tests passed, including new voice timeout coverage.
- Local native SDK source check blocked by absent private Trimble package; this is an environment limitation, not evidence of an Android regression.
- Tooling tests and hybrid native handoff checks passed.
- API build and tests: 320 passed, 43 skipped; isolated database integration coverage is outstanding.
- Admin production build passed with explicit API URL.
- Live API health returned HTTP 200, database ok, and revision-v1 truck verification support.
- Unauthenticated trucks endpoint returned HTTP 401 as expected.
- Authenticated web admin login, driver list, and profile detail loaded successfully.
- No physical-device guidance, speaker output, Bluetooth behavior, background GPS, full offline trip, or store purchase was certified.

## Completion order

1. Resolve actual saved-profile compatibility without inventing vehicle facts.
2. Reproduce and identify the phone's profile request failure; add sanitized stage/error diagnostics if needed.
3. Finish dependency updates and regression checks; deploy only reviewed backend changes.
4. Build a signed Android update from the repair branch and verify installed commit identity.
5. Perform parked voice/map/start checks, then controlled guidance/reroute/background/offline tests.
6. Complete provider integrations and unsupported UI behavior.
7. Complete isolated database, subscription, document, account recovery, and multi-device regression testing before public release.
