# Step 2 — CoPilot map and engine lifecycle

Status: Partially fixed. Licensed Android rendering/lifecycle acceptance remains blocked on SDK/device access and Step 1 profile acceptance.

## Diagnosis and correction

CopilotLifecycle serializes license, configuration, map-inventory and route-readiness checks. These bridge reads previously had no JavaScript deadline. One unresolved promise could block all queued rechecks, leaving startup/foreground checks waiting indefinitely. Reusing a disposed observer also retained its old pending queue.

Each read-only query now has a 10-second deadline and a sanitized COPILOT_READINESS_TIMEOUT diagnostic identifying the failed stage. Existing bounded retry policy remains in control; route-readiness timeouts require an explicit recheck. A new start uses a fresh queue. Existing revision checks prevent old responses and timeout errors from overwriting a later lifecycle or reviving readiness after shutdown.

This does not cancel a native query, restart the SDK, claim an SDK callback occurred, alter licenses, download/delete maps, change truck profiles, or enable guidance. It does not prove a frozen rendering surface is repaired.

## Audit scope

- CopilotLifecycle.ts: event ordering, startup timeout, serialized readbacks, readiness gates, shutdown/disposal.
- CopilotProvider.tsx: foreground rechecks, explicit retries, map download orchestration; unchanged.
- CopilotOfflineMap.tsx: mounts the SDK view only after native initialization, licenses and installed map checks; unchanged.
- CoPilotHostModule.java: native map/start guards and trip startup reviewed; unchanged in this PR.

## Exact files changed

- apps/mobile-react-native/src/services/copilot/CopilotLifecycle.ts
- apps/mobile-react-native/__tests__/copilot-lifecycle.test.ts
- docs/verification/step-02-copilot-lifecycle.md

## Verification

Targeted lifecycle suite: 27 tests passed, including all four stalled read stages, recovery after timeout, disposal/restart with an unresolved prior query, and late-response rejection after shutdown. TypeScript passed. Final full-suite results are recorded in the PR.

The test environment installs JS dependencies without the proprietary CPIK package. Mock port callbacks are unit-test evidence only. No APK was built or installed.

## Physical acceptance still required

On the existing licensed installation, without clearing data: cold start, warm start, lock/unlock, background/foreground, orientation changes and process recreation. Confirm only one native renderer is attached, follow/zoom remain responsive, lost licenses or missing maps block controls, and installed California map inventory remains unchanged. Capture sanitized diagnostics on any failure. Repeat after Step 1's actual native truck-profile readback passes.

## Next step and rollback

Step 3: Start Navigation. Native geocoding currently runs before the route-confirmation polling deadline begins; investigate that path for an indefinite wait before claiming Start is repaired.

No merge or deployment authorized. Close this draft for rollback before deployment; after a separately approved deployment, revert its commit. No data migration is required.
