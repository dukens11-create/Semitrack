# SemiTrax Navigation Production-Readiness Audit

Audit date: 2026-08-29

## Executive conclusion

SemiTrax has real server-side commercial-truck route calculation, a real Android fused-location foreground service, route rendering, truck-profile validation, route-corridor POIs, GPS-driven progress, and a provider boundary for HERE and Trimble. It is not yet a production-certified turn-by-turn navigation system.

The principal release blocker is native guidance: the Android guidance engine is intentionally an unavailable stub until a licensed HERE Navigate or Trimble Maps native navigation SDK is integrated. The Flutter REST-assisted mode can preview and follow a truck-safe route, but its progress, maneuvers, ETA, map matching, speed limits, background guidance, and arrival logic do not yet have the guarantees of a native navigation engine.

The next architecture milestone should be extracting navigation session state out of `truck_map_screen.dart` before changing map renderers. That screen currently owns map rendering, GPS filtering, route progress, rerouting, voice, POIs, safety alerts, trip state, and a large amount of UI in one file.

## Current architecture

- Flutter UI and session orchestration: `lib/screens/truck_map_screen.dart`
- Shared route matching/progress: `lib/models/route_progress.dart`
- Latest-request serialization: `lib/services/latest_request_coordinator.dart`
- Flutter/native bridge: `lib/services/native_navigation_service.dart`
- Android navigation manager and foreground GPS: `android/app/src/main/kotlin/com/example/semitrack_mobile/navigation/`
- Backend provider contract: `apps/api/src/services/providers/routeProvider.ts`
- Provider selection: `apps/api/src/services/routingService.ts`
- HERE truck routing: `apps/api/src/services/providers/hereProvider.ts`
- Trimble truck routing: `apps/api/src/services/providers/trimbleProvider.ts`
- Mapbox traffic preview only: `apps/api/src/services/providers/mapboxProvider.ts`
- Commercial POIs and live corridor data: `lib/services/poi_service.dart` and `lib/services/live_road_data_service.dart`

## 1. Production-ready foundations

These components have appropriate production-oriented boundaries or safety behavior, although the complete product still needs end-to-end road testing.

| Area | Current state |
| --- | --- |
| Truck route provider boundary | `RouteProvider` isolates provider-specific request and response logic. HERE and Trimble return a normalized route contract. |
| Secret handling | Provider keys are read by the API from environment configuration; no Trimble secret is required in the Flutter bundle. `.env.example` documents the local fields. |
| Truck input validation | Height, width, length, weight, axle count/weight, trailers, hazmat, and avoidance preferences are typed and validated before provider calls. |
| Trimble REST routing | Real Route Reports integration supplies truck route mileage, duration, geometry, directions, warnings, and licensed alternatives where enabled. |
| HERE REST routing | Real HERE truck routing sends vehicle dimensions, weights, axle count, trailers, hazmat, alternatives, via points, and supported avoidances. |
| Mapbox safety boundary | Mapbox traffic output is marked non-truck-safe and cannot be accepted as the navigation route. It is not a truck-routing fallback. |
| Reroute concurrency | Route calculation uses serialized latest-wins coordination. A newer request supersedes a queued older request, and the current route stays active until its replacement succeeds. |
| Route-specific async state | Route revisions prevent late POI, weigh-station, and live-road responses from mutating a newer route. |
| Duplicate-object prevention | Permanent POIs are maintained separately from route-specific objects. Route overlay and temporary marker state are replaced instead of appended during reroute. |
| Heading safety | Bearings are normalized to 0–360 degrees and interpolated across the shortest angular path. |
| Map matching safety | GPS snapping, off-route distance, route index, and remaining distance now share one bounded route match, preventing jumps to distant crossing sections. |
| Lifecycle crash guards | Async camera and route callbacks check mounted/map/controller state and use generation tokens to reject stale completion. |
| Android foreground GPS | A declared location foreground service uses fused high-accuracy updates and a persistent navigation notification. |
| Screen awake behavior | Android keep-screen-on is enabled only while the navigation notifier is active and is cleared on teardown. |
| Honest unavailable data | Unknown speed limits and unavailable live POI details render as unknown; the app does not invent operational values. |

## 2. Partially implemented

| Area | What works | Remaining weakness |
| --- | --- | --- |
| Navigation lifecycle | Route state survives rerouting; background-to-foreground now refreshes native status, GPS, route POIs, and camera without rebuilding the map. | Native guidance events are not persisted/replayed if Flutter is detached. Process death recovery is not implemented. |
| GPS filtering | Accuracy, stopped drift, candidate fixes, impossible jumps, and stale-signal watchdog are handled. | It is heuristic GPS filtering, not provider road-level map matching. Urban canyons and frontage roads still need field tuning. |
| Truck-marker motion | Marker position is linearly interpolated between accepted fixes and stale animations are canceled. | No Kalman filter/dead reckoning; delayed fixes can still visually lag. |
| Camera follow | Speed- and maneuver-aware zoom, pitch/bearing smoothing, free/overview/follow modes, and lower-third framing exist. Camera operations are now serialized. | The visible `flutter_map` camera cannot provide all native 3D navigation behavior; camera policy is still embedded in the screen. |
| Route progress | Bounded projection provides continuous distance rather than vertex-only drops. Progress cannot rewind from normal jitter. | No provider road-position object or along-route confidence score is exposed to the UI. |
| Remaining ETA | Native values are authoritative when available; otherwise distance is measured on geometry. | REST fallback ETA is a linear proportion of original duration and does not continuously recompute traffic/delay. |
| Off-route detection | Accuracy-aware 50–80 m corridor, motion gate, 5-second confirmation, startup suppression, cooldown, API guards, and latest-wins rerouting exist. | Thresholds are not road-class aware and need replay/field tests for frontage roads, ramps, and dense interchanges. |
| Voice guidance | TTS lifecycle, duplicate announcement guards, and maneuver distance announcements exist. | Fallback synchronization is proximity/step based; reliable background voice needs native guidance. |
| Maneuvers and lanes | Provider maneuver data is parsed; UI does not fabricate lane recommendations when none exist. | Native real-time lane/junction guidance remains unavailable. Sparse REST geometry can make step timing imperfect. |
| Speed limits | UI and over-speed behavior accept provider values and show `--` when unknown. | REST fallback does not currently populate a posted, truck-specific speed limit feed. |
| Traffic | HERE/Trimble can calculate traffic-aware routes; Mapbox can provide a clearly labeled non-truck-safe traffic preview. | No live traffic refresh/reconciliation policy during an active route. |
| Restrictions | Truck profile and provider warnings flow through route calculation; live-road corridor services can return restrictions. | On-device imminent low-bridge/restriction guidance depends on provider coverage and fresh authoritative data. |
| Alternatives and avoidances | HERE supports alternatives and broad avoidances. Trimble supports entitled alternatives plus verified toll/ferry controls. | Trimble does not expose verified equivalents for every UI preference; unsupported options are reported rather than silently sent. |
| Multi-stop trips | Via points/trip legs exist and native bridge accepts waypoints. | Reordering, skip-stop policy, per-leg recovery, and persisted resume need dedicated state-machine tests. |
| Arrival | A one-shot arrival flow completes analytics, clears navigation flags, announces arrival, and shows completion UI. | Detection is currently a 30 m radial threshold without dwell, low-speed, heading, or final along-route confirmation. |
| Network failures | Flutter requests have a 20-second timeout; provider errors distinguish auth, quota, unavailable route, and retryability. | Flutter discards some structured retry metadata and has no bounded exponential backoff/`Retry-After` policy for transient route calls. |
| API logging | Route provider identity and reroute request lifecycle are logged. | No centralized redacted structured logging, correlation dashboard, crash reporting, or production alerting is wired. |
| Android permissions | Foreground/background location and notification permissions are declared and runtime location permission is handled. | Android-version-specific background permission education, denial analytics, and OEM battery-optimization recovery need device coverage. |
| Battery efficiency | Foreground ownership and stale-stream recovery are explicit. | GPS currently requests 500 ms high-accuracy fixes with zero distance filter even in ordinary map browsing; an adaptive idle/navigation policy is needed. |
| Offline behavior | Previously loaded route remains visible when a replacement fails; Mapbox tiles can be downloaded. | Offline tiles are not offline truck routing or offline guidance. New routes and reroutes require the API/provider. |

## 3. Missing before production turn-by-turn release

1. A licensed native truck guidance engine implementation behind `NativeGuidanceEngine`.
2. Provider-grade road snapping/map matching with confidence, matched road, and progress events.
3. Persisted navigation session recovery after Android process death, including destination, provider, route ID/geometry, waypoints, progress, and spoken-maneuver state.
4. Native/background maneuver and voice guidance that does not depend on an attached Flutter UI isolate.
5. Authoritative truck speed-limit feed and real-time updates.
6. Road-class-aware off-route thresholds and a recorded GPS replay test suite.
7. Arrival confirmation using final-route progress plus distance, speed/dwell, and heading.
8. A bounded transient retry policy with jitter, cancellation, `Retry-After`, and idempotency rules.
9. Centralized redacted telemetry/crash reporting with route request IDs and provider latency/error metrics.
10. Adaptive location sampling for idle, low-speed, highway, foreground, and background states.
11. Automated Android integration tests covering permission changes, background/resume, controller disposal, network loss, and at least ten consecutive reroutes.
12. Offline commercial routing/guidance, if offline navigation is a product requirement.
13. A dedicated navigation session controller/state machine separate from widgets and map rendering.

## 4. Mocked, simulated, or approximate behavior

- `TruckSafeGuidanceUnavailableEngine` is an intentional native placeholder. It reports `TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE`; it must not be described as active native navigation.
- Simulation movement exists behind `_isSimulationMode`, which defaults to false. Production progress uses real GPS unless a developer explicitly enables simulation.
- REST fallback ETA is an approximation derived from the provider's original route duration and the fraction of geometry remaining.
- REST fallback maneuver timing is based on GPS distance/route step matching, not a native guidance engine.
- Speed limit is not guessed. Zero means unavailable and the UI shows `--`.
- Bundled POIs and official snapshot datasets are real stored records but are not inherently live. Status, parking, fuel, and weigh-station activity must identify their source/freshness and remain unknown when unavailable.
- The restaurant sample asset is excluded from production POI loading.
- Offline map downloads are tiles only; they do not imply offline route calculation.
- Mapbox driving-traffic is preview-only and explicitly not commercial-truck safe.

## 5. Licensing and credential dependencies

| Capability | Dependency |
| --- | --- |
| HERE REST truck routes | Valid HERE API credentials and truck-routing entitlement. |
| HERE native turn-by-turn | Commercial HERE SDK Navigate artifacts/credentials and an implemented `NativeGuidanceEngine`; currently blocked. |
| Trimble truck routes | Valid `TRIMBLE_API_KEY`, trial/production entitlement, and configured `TRIMBLE_PROFILE_NAME`. Trial expiry must be treated as an auth/entitlement error. |
| Trimble route geometry and alternatives | RoutePath/GeoTunnel/Alternate Routes entitlements and the corresponding server feature flags. |
| Trimble native turn-by-turn | A licensed Trimble Maps mobile navigation SDK and a separate native engine implementation; REST routing alone is insufficient. |
| Mapbox map/traffic preview | Valid Mapbox token and license-compliant usage. It cannot replace a commercial-truck route provider. |
| 511/live road data | Jurisdiction endpoints, credentials where required, data-use terms, and coverage/freshness by state. |
| Commercial POI/live parking/fuel | Provider licenses and explicit freshness/source contracts. No availability should be inferred when data is absent. |

HERE and Trimble route geometry, maneuvers, restriction identifiers, and proprietary attributes must remain provider-scoped. Do not combine proprietary segments or derive one provider's navigation product from another provider's restricted data unless the applicable licenses explicitly allow it.

## 6. Fix before replacing `flutter_map`

Do not replace the renderer while `truck_map_screen.dart` remains the navigation state owner. A map migration would otherwise mix renderer regressions with route/session regressions.

Required sequence:

1. Extract an immutable `NavigationSessionState` and a tested `NavigationSessionController` with explicit states: idle, planning, preview, starting, navigating, rerouting, paused, arrived, stopping, and failed.
2. Move GPS acceptance, route matching, progress, off-route detection, reroute coordination, arrival, and voice policy out of the widget.
3. Introduce a `NavigationMapAdapter` for camera, route overlay, truck marker, permanent POIs, temporary route objects, hit testing, and disposal.
4. Give every route overlay and route-specific marker a session/revision ID. Applying a new revision must be one replace operation, never append.
5. Define provider-neutral route and guidance models, but retain opaque provider IDs only inside their provider adapter.
6. Add renderer contract tests: repeated replace/clear, style reload, background/resume, controller disposal, gesture/follow transitions, and no duplicate objects.
7. Add recorded GPS replay tests before and after the renderer change and require identical progress/reroute/arrival decisions.
8. Only then implement the new SDK-backed map adapter and run both renderers behind a developer flag until parity is demonstrated.

## Recommended release gates

- Zero analyzer/type errors and no unhandled platform-channel exceptions.
- Ten-plus intentional route deviations in one session with no duplicated markers, stale route objects, camera corruption, freeze, or crash.
- Recorded crossing-road/frontage-road GPS traces do not jump route progress.
- Route replacement failure leaves the current route and guidance usable.
- Background/resume and permission revocation tests pass on the supported Android versions and at least one Samsung device.
- Arrival does not trigger on a parallel road or when merely passing near the destination.
- Every route response and reroute log identifies provider, request ID, duration, result, and redacted failure category.
- No key, token, precise driver location, or provider payload is written to unrestricted logs.
- A closed-course safety review is completed before presenting the app as production turn-by-turn truck navigation.

## Verification performed for this audit

- Full `flutter analyze --no-pub --no-fatal-warnings --no-fatal-infos`: completed with zero errors. It reports 179 pre-existing warnings/info items, primarily unused legacy helpers in `truck_map_screen.dart` and deprecated `withOpacity` calls.
- Focused navigation tests: 15 passed, including twelve rapid reroutes with no overlap, bearing wrap-around, route corridor ordering, smooth progress, and a crossing-road no-jump case.
- Additional Flutter resilience/model tests: 15 passed, covering request timeout/error handling, app error guards, commercial POI filtering, and navigation-related models.
- API `npm run typecheck`: passed.
- API `npm test`: 34 passed, including HERE truck units/timestamp, Trimble truck profile, provider-data isolation, response normalization, secret transport, quota errors, live road data, ELD normalization, and admin validation.
- Android arm64 debug build: source compilation was attempted but the host sandbox denied reads to `C:\Users\duken\.gradle\caches\...\kotlin-stdlib-jdk7-1.8.20.jar` and denied writing `build\reports\problems\problems-report.html`. This is an environment permission failure, not a reported Dart/Kotlin compile error. Re-run the build from the user's normal PowerShell environment before release.
