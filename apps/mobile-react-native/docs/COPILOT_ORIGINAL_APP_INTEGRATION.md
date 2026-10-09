# CoPilot integration on the restored SemiTraX app

## Source-of-truth protection
- Base: `recovery/semitrax-original-2026-09-20` (React Native 0.85.0).
- Work only from `codex/original-semitrax-copilot-integration` for CoPilot changes.
- Never merge or cherry-pick from `codex/react-native-migration-staging`.
- Keep the original Mapbox-based PlanningScreen, route preview, POI, Documents, recent destinations, saved appearance, truck profiles, and Diagnostics UI. No visual redesign.
- Preserve the restored installed app: do not uninstall, clear data, replace signing identity or migrate storage as part of integration.

## Verified source behavior at branch creation
- `src/screens/PlanningScreen.tsx` uses `TruckMap` and `RoutePreview`, with POI controls and guidance session wiring.
- `src/services/copilot/CopilotRuntime.ts` inventories CoPilot modules, licensing and installed maps; `prepareProvisioning()` returns null and `startNative()` intentionally throws `COPILOT_NATIVE_STARTUP_VALIDATION_REQUIRED`.
- `src/native/navigation/NativeGuidanceAdapter.ts` is fail-closed: even a successful native call cannot mark navigation active.
- `src/services/copilot/CopilotPrerequisites.ts` requires native build verification, started runtime, navigation and heavy-truck licensing, precise GPS and matching licensed installed maps. Passing that gate does **not** establish truck-profile parity or route coverage.

## Implementation sequence (do not bypass a stage)
1. On a separate build, inspect CoPilot native SDK and version compatibility, lifecycle binding, foreground service and `CopilotView` setup. Fix Android crashes before SDK startup is enabled.
2. Implement approved secure credential provisioning without committing secrets; verify Device ID/license identity and cold-start rehydration on Samsung.
3. Complete reliable licensed-map inventory and first-install completion; only use exact installed regions and versions as readiness evidence.
4. Translate every supported truck restriction from the saved SemiTraX truck profile; hard-fail unsupported values rather than silently relaxing them.
5. Verify truck-safe CoPilot route results, regional coverage, maneuvers, restrictions and guidance entitlement; do not use car-routing fallbacks for safety-critical guidance.
6. Integrate navigation events into the existing `GuidanceSession` while retaining the original Mapbox UI. Distinguish a display map from the authoritative CoPilot truck route; never draw misleading safety guidance.
7. Run source checks, a separate debug APK build, Samsung cold launch, installed map verification, truck-profile/route-coverage tests, route preview and turn-by-turn device tests; record evidence before approval.

## Release gate
Navigation remains disabled unless all of these are proven on-device: SDK init and license, full navigation + heavy-duty entitlement, exact offline map installed and covered, precise location, valid truck profile, verified truck-safe route and functioning guidance. A visible map or downloaded map alone is **not** proof of navigation readiness.
