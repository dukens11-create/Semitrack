# Mapbox display / CoPilot engine proof

Mapbox now renders the normal browsing and planning map. The native engine remains mounted beneath it and owns trip preparation, truck profiles and guidance. Native setup and settings remain visible when needed.

## Entry

Prepare a truck trip using the existing reviewed CoPilot profile and Start Navigation flow. After confirming Go in the engine, its navigation-screen callback opens the Mapbox driving view. To manage or end the trip, select **Trip controls**; **Return to navigation map** reopens Mapbox. Closing the test view does not stop the trip.

## Data path

- CPIK 10.28.2-497 exposes `GuidanceMgr.getRouteCoordinates(true, 25.0, 1.0)` in the installed JAR. It supplies the next 25 miles of the active engine route at the finest supported granularity; this is not the entire trip.
- Native snapshots include the engine route revision, current position, next instruction, ETA and remaining distance. No backend planning polyline is substituted.
- During guidance Mapbox renders the route and engine position. The planning map uses the backend planning geometry only before the engine trip handoff. Its street/satellite styles and attribution remain intact. Mapbox Directions/Navigation routing is not used.
- The native CoPilot view remains mounted underneath the React Native modal. No unverified headless lifecycle change is introduced. Existing engine voice and trip controls remain authoritative.
- Route calculation events invalidate the displayed geometry immediately. Late results from previous revisions are discarded. GPS freshness and a five-second display snapshot limit suppress stale guidance.

## Validation and outstanding device checks

Automated tests cover schema/range validation, stale GPS, route states, late responses during recalculation, and bridge failures. Android build compiles the native API bridge against the bundled CPIK SDK.

A Samsung test is still required for map token/style loading, engine updates while the modal is open, route alignment, recalculation, voice continuation, returning to the engine, and background/foreground behavior. This proof does not establish production readiness or contractual permission to redistribute Trimble data on another map. Confirm provider licensing before a production rollout.

References:
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/guidancemgr/navigation/
- https://docs.mapbox.com/android/maps/examples/android-view/draw-a-geojson-line/
