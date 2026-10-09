# Restored SemiTraX CoPilot map integration

Based on recovery/semitrax-original-2026-09-20 (7514d2d8e2f9e5d1961e95fde29f0be15b09f6c4). The Planning screen uses the vendor CopilotView, with no Mapbox rendering fallback. Mapbox remains for existing address lookup and the retained unused legacy component. The Offline Maps page uses CoPilot setup and inventory; it no longer creates Mapbox display packs.

The native host stores the assigned Company ID and Device ID using Android Keystore encryption. It restores setup on launch, verifies the active AMS identity and Full Navigation/Heavy-Duty Truck features, and queries actual installed-map inventory. It rejects identity changes and does not deactivate or replace existing licenses. California is the initial selected coverage. Downloads run while the app is open, with cellular map downloads disabled, bounded busy retries and installed-inventory verification. A download acceptance response is not installation proof.

CoPilot supplies the visible map, camera, day/night appearance and map selection events. Backend route geometry is a dashed planning overlay. Stop/POI markers and map controls remain in the restored UI. Satellite imagery is unavailable in this offline renderer.

This is map and setup integration, not completed live guidance. Native guidance is suspended on startup. Truck-profile restriction parity, native route coverage and Samsung guidance acceptance remain required. No safety gate was removed.

The device-review debug package is com.semitrax.app.restored.copilot.debug, labelled SemiTraX CoPilot and separate from the migration and previous test apps. It needs its own secure device setup and inventory check. Do not uninstall or clear existing apps to test it.

Validation is recorded in the pull request and build run. Required Samsung acceptance: enter this phone's assigned IDs once, allow precise location, verify licensing; confirm California inventory and visible CoPilot map; exercise recenter/compass/zoom/overview, POI selection and route cancellation; cold-launch twice to confirm restoration. Confirm existing apps and data remain intact. A CI build cannot provide this runtime evidence.
