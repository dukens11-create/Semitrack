# CoPilot primary-map replacement — draft, not device accepted

Based only on restored branch `recovery/semitrax-original-2026-09-20`, commit
`7514d2d8e2f9e5d1961e95fde29f0be15b09f6c4`. No migration app code used.

The requested main-map replacement mounts the vendor `CopilotView` instead of
`TruckMap` / Mapbox. There is no automatic Mapbox map fallback. Both the map
and setup banner observe one shared CoPilot lifecycle instance. The native view
is mounted only with started runtime, licensing readiness, Full Navigation,
Heavy-Duty Truck and verified installed offline maps; it unmounts when those
checks are lost. The vendor view manager dereferences `CopilotMgr.getView()`,
so mounting it before startup would be unsafe.

This is a **draft integration**, not a working replacement APK. Current restored
source still returns null from `prepareProvisioning()` and rejects native startup.
Consequently the main map currently shows a setup blocker, not live CoPilot maps.
Native startup and secure device credential restoration must be implemented and
verified before this can replace the installed app.

## Verified administrator state

On October 8, 2026, Trimble Account Manager showed company `XGNKEA`, Mobile
Device ID licensing and `SemiTraX-Android-Test-01` Activated with CoPilot Truck
with ActiveTraffic — North America (Monthly). Existing default map set Semitrax
includes California, Nevada and Oregon within North America. These dashboard
observations do not prove either restored-app runtime entitlements or installed
map inventory. No account settings or license assignments were changed.

## Release blockers retained

- Secure provisioning and safe native startup; Android device validation.
- CoPilot camera/recenter/overview, saved day/night rendering and map interactions.
- CoPilot stop markers, truck-route drawing and POI selection equivalents.
- Exact California installed-map and route coverage verification on the restored app.
- Truck-profile parity and native guidance verification. No safety gate was disabled.

Mapbox remains a dependency for existing address lookup and the preserved legacy
renderer source. It is no longer mounted by PlanningScreen in this draft. A
backend route estimate must not be presented as an active CoPilot native route.
Satellite imagery and camera controls report unavailable rather than silently
doing nothing. Existing source tests that require the old map's interaction
contracts remain intact; they expose the unfinished equivalents above.

## Validation

- Typecheck and changed-file ESLint pass.
- Eight new native-map gate tests pass, including unmounting after startup loss.
- Full application tests still fail on eight existing map interaction/rendering
  contracts. These failures are release blockers, not waived tests.
- No Android build, signing, installation or on-device runtime acceptance claimed.

Do not merge or install this draft until the map interaction contracts and native
startup are completed and tested. Existing Samsung apps, licenses and maps remain
untouched.
