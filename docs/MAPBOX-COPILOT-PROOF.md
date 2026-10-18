# Mapbox display / CoPilot engine proof

This branch adds an optional, read-only test view. It does not replace the normal map or transfer trip ownership to Mapbox.

## Entry

Prepare a truck trip using the existing reviewed CoPilot profile and Start Navigation flow. In the engine view, select **Mapbox engine test**. To manage or end the trip, select **Return to engine controls**. Closing the test view does not stop the trip.

## Data path

- CPIK 10.28.2-497 exposes `GuidanceMgr.getRouteCoordinates(true, 25.0, 1.0)` in the installed JAR. It supplies the next 25 miles of the active engine route at the finest supported granularity; this is not the entire trip.
- Native snapshots include the engine route revision, current position, next instruction, ETA and remaining distance. No backend planning polyline is substituted.
- Mapbox renders the route and engine position. Its street/satellite styles and attribution remain intact. Mapbox Directions/Navigation routing is not used.
- The native CoPilot view remains mounted underneath the React Native modal. No unverified headless lifecycle change is introduced. Existing engine voice and trip controls remain authoritative.
- Route calculation events invalidate the displayed geometry immediately. Late results from previous revisions are discarded. GPS freshness and a five-second display snapshot limit suppress stale guidance.

## Validation and outstanding device checks

Automated tests cover schema/range validation, stale GPS, route states, late responses during recalculation, and bridge failures. Android build compiles the native API bridge against the bundled CPIK SDK.

A Samsung test is still required for map token/style loading, engine updates while the modal is open, route alignment, recalculation, voice continuation, returning to the engine, and background/foreground behavior. This proof does not establish production readiness or contractual permission to redistribute Trimble data on another map. Confirm provider licensing before a production rollout.

References:
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/guidancemgr/navigation/
- https://docs.mapbox.com/android/maps/examples/android-view/draw-a-geojson-line/
