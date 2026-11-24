# Feature boundaries

The foundation separates account/session, truck profiles, ordered stops, routing, map display, search, POIs, corridor records, preferences, native location and guidance. The screens compose services; they do not implement routing providers.

`NavigationEngine` is the future commercial-guidance boundary. Its typed events include route IDs and actual maneuver geometry offsets. `NativeSemiTraxPlatform` transports native commands; Kotlin and Swift `GuidanceBoundary` implementations deliberately reject activation. An SDK integration must implement the engine and native boundary together, validate vendor events, and pass actual device tests. It must not activate solely because a native promise resolves.

`LocationService` is independent of guidance. Coordinates, timestamps, accuracy, heading and speed originate from Android LocationManager or iOS CoreLocation. Stale/inaccurate fixes are rejected. Foreground preview tracking is exposed now. Explicit background tracking is implemented at the native boundary but not offered as navigation while guidance is unavailable. Do not start background location from a headless task.

Parking, weigh stations, fuel, traffic and DOT/511 currently share `PoiService.corridor` and the provider-record presentation in `features/dot511`. A later feature can add a typed adapter and interaction without changing truck routing. Empty results mean unknown coverage. Unsupported POI categories have no invented requests or seed results.

Trips, documents, fleet/dispatch, subscription purchases, ELD UI and offline downloads are intentionally deferred. No empty implementation directories or fake service classes imply readiness. See the repository migration matrix for their actual Flutter/backend status. Favorites, destination time zones, read-only billing catalog, warning cards, camera media and community reporting UI still require a parity pass. No product notification or Firebase SDK is installed.

Mapbox geocoding results are temporary and memory-only. Adding server favorites from those results requires resolving the provider's permanent-storage licensing. Mapbox attribution and controls remain visible; it supplies display/search, never passenger directions.

Keep application and provider secrets on the server. Public API URL and Mapbox display token are build configuration, not secrets. Credentials and auth tokens must never appear in error logs, analytics, route fixtures or crash payloads. The generic telemetry adapter is not activated until event contract and product consent are verified.
