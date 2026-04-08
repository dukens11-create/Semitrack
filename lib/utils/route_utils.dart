import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/models/poi_item.dart';

// ── Snap-to-Road ─────────────────────────────────────────────────────────────

/// Distance threshold used by [isOnRoute] and recommended for all
/// "on-route / off-route" checks: **40 metres**.
///
/// A GPS fix within 40 m of the route polyline is considered "on route".
/// Values above this threshold trigger off-route handling (warnings,
/// recalculation, etc.).
///
/// Adjust the constant here rather than at every call site to keep the
/// behaviour consistent across the app.
const double kSnapToRouteThresholdMeters = 40.0;

/// The result returned by [snapToRoad].
///
/// Bundles the snapped coordinate, the distance to it, and the original
/// unmodified coordinate so callers never need to hold onto the original
/// separately.
class SnapResult {
  const SnapResult({
    required this.snappedPoint,
    required this.distanceMeters,
    required this.sourcePoint,
  });

  /// The nearest vertex on the route polyline to [sourcePoint].
  ///
  /// Use this **only for logic** (distance checks, route-matching, filtering).
  /// Never use it to position a map marker or icon — always use [sourcePoint]
  /// for any visual / display purpose.
  final LatLng snappedPoint;

  /// Haversine surface distance in metres from [sourcePoint] to [snappedPoint].
  ///
  /// Compare against [kSnapToRouteThresholdMeters] to decide whether the
  /// vehicle or POI is "on route":
  ///
  /// ```dart
  /// final bool onRoute = result.distanceMeters <= kSnapToRouteThresholdMeters;
  /// ```
  final double distanceMeters;

  /// The original, unmodified coordinate that was passed to [snapToRoad].
  ///
  /// Use this for **all display purposes** (truck marker, POI icon, etc.) and
  /// for any distance-remaining / ETA calculations that must reflect the real
  /// GPS position.
  final LatLng sourcePoint;
}

/// Snaps [point] to the nearest vertex on [routePoints] and returns a
/// [SnapResult] containing the snapped coordinate, the distance to it, and the
/// original unmodified point.
///
/// ---
/// ⚠️  **Logic use only — never use for display.**
///
/// `snapToRoad` is a *routing-logic* primitive.  The [SnapResult.snappedPoint]
/// it returns is appropriate **only** for:
///
/// - Detecting whether the vehicle is "on route" — compare
///   [SnapResult.distanceMeters] against [kSnapToRouteThresholdMeters] (40 m).
/// - Filtering or ranking POIs relative to the active route.
/// - Computing distance-to-route for off-route detection or recalculation.
///
/// It is **not** appropriate for:
///
/// - Visually placing a truck marker, POI icon, or any map overlay.
/// - Overriding the stored GPS or entrance coordinates of a POI.
/// - Any "display" or rendering purpose whatsoever.
///
/// For map display, always use the **source** coordinate directly:
///
/// - Truck marker → real GPS `LatLng(position.latitude, position.longitude)`.
/// - POI marker   → `LatLng(poi.displayLat, poi.displayLng)` (entrance when
///                  available, centre otherwise — see [PoiItem.displayLat]).
///
/// See [getPoiDisplayLocation] for the canonical display-coordinate helper.
///
/// ---
/// ### Algorithm
///
/// Iterates over every vertex in [routePoints] and tracks the one with the
/// minimum haversine distance to [point].  O(n) in the number of route
/// vertices; accurate for densely sampled Mapbox routes (vertices every
/// 10–50 m).
///
/// For coarser routes, consider replacing the vertex loop with a true
/// point-to-segment projection (e.g. using `turf_dart`'s
/// `nearestPointOnLine`).
///
/// ---
/// ### Parameters
///
/// - [point]       – The coordinate to snap (e.g. current GPS fix or a POI
///                   coordinate for logic use).
/// - [routePoints] – Ordered list of [LatLng] vertices from the active route.
///
/// ---
/// ### Returns
///
/// A [SnapResult] containing:
///
/// - [SnapResult.snappedPoint]    – Nearest route vertex to [point].
/// - [SnapResult.distanceMeters]  – Distance in metres from [point] to
///                                  [snappedPoint].
/// - [SnapResult.sourcePoint]     – The original, unmodified [point]; use
///                                  this for all display and ETA calculations.
///
/// When [routePoints] is empty the function returns a safe no-op fallback:
/// [SnapResult.snappedPoint] equals [point] and [SnapResult.distanceMeters]
/// is `0.0`.
///
/// ---
/// ### Example — "on route" check (✅ correct usage)
///
/// ```dart
/// final SnapResult result = snapToRoad(
///   LatLng(position.latitude, position.longitude),
///   activeRoutePoints,
/// );
///
/// final bool onRoute =
///     result.distanceMeters <= kSnapToRouteThresholdMeters; // 40 m
///
/// if (!onRoute) _triggerOffRouteWarning();
///
/// // Always render the truck at the REAL GPS position, not the snapped one:
/// renderTruckMarker(result.sourcePoint); // ← sourcePoint, NOT snappedPoint
/// ```
///
/// ### Example — POI filtering (✅ correct usage)
///
/// ```dart
/// final nearbyPois = allPois.where((poi) {
///   final SnapResult r = snapToRoad(
///     LatLng(poi.displayLat, poi.displayLng),
///     routePoints,
///   );
///   return r.distanceMeters <= 500; // 500 m corridor
/// }).toList();
///
/// // Render markers at the ORIGINAL POI coordinates, not the snapped ones:
/// for (final poi in nearbyPois) {
///   addMarker(getPoiDisplayLocation(poi)); // ← real coord, never snapped
/// }
/// ```
///
/// ### Example — ❌ wrong usage (never do this)
///
/// ```dart
/// // DON'T snap a POI for display — use the real entrance/centre coords.
/// final snapped = snapToRoad(LatLng(poi.lat, poi.lng), routePoints);
/// addMarker(snapped.snappedPoint); // ← WRONG: moves the pin off the property
/// ```
SnapResult snapToRoad(LatLng point, List<LatLng> routePoints) {
  // Defensive fallback: if there is no route to snap to, return the original
  // point unchanged with a zero distance so callers can proceed safely.
  if (routePoints.isEmpty) {
    return SnapResult(
      snappedPoint: point,
      distanceMeters: 0.0,
      sourcePoint: point,
    );
  }

  LatLng nearestVertex = routePoints.first;
  double minDistanceMeters = Geolocator.distanceBetween(
    point.latitude,
    point.longitude,
    nearestVertex.latitude,
    nearestVertex.longitude,
  );

  // Walk every vertex and keep track of the one closest to [point].
  for (int i = 1; i < routePoints.length; i++) {
    final LatLng vertex = routePoints[i];
    final double d = Geolocator.distanceBetween(
      point.latitude,
      point.longitude,
      vertex.latitude,
      vertex.longitude,
    );
    if (d < minDistanceMeters) {
      minDistanceMeters = d;
      nearestVertex = vertex;
    }
  }

  return SnapResult(
    snappedPoint: nearestVertex,
    distanceMeters: minDistanceMeters,
    // Always carry the original point so callers never need to hold onto it
    // separately — and are not tempted to use the snapped point for display.
    sourcePoint: point,
  );
}

/// Returns `true` when [point] is within [thresholdMeters] of the nearest
/// vertex on [routePoints].
///
/// This is the recommended high-level helper for "on-route / off-route" logic.
/// Internally it calls [snapToRoad] and compares [SnapResult.distanceMeters]
/// against [thresholdMeters] (default [kSnapToRouteThresholdMeters] = 40 m).
///
/// ### Usage
///
/// ```dart
/// if (!isOnRoute(LatLng(position.latitude, position.longitude), routePoints)) {
///   _recalculateRoute();
/// }
/// ```
///
/// For off-route checks that also need the distance value, call [snapToRoad]
/// directly instead.
bool isOnRoute(
  LatLng point,
  List<LatLng> routePoints, {
  double thresholdMeters = kSnapToRouteThresholdMeters,
}) {
  final SnapResult result = snapToRoad(point, routePoints);
  return result.distanceMeters <= thresholdMeters;
}

// ── Display-location helpers ──────────────────────────────────────────────────

/// Returns the best-available **display** coordinate for [poi] — the
/// coordinate that should be used to place the POI's map marker or icon.
///
/// ### Rule: display code must never snap
///
/// This function exists to make the correct pattern explicit and
/// discoverable.  It always returns a **real, stored coordinate**:
///
/// 1. If the POI has verified entrance coordinates ([PoiItem.entranceLat] /
///    [PoiItem.entranceLng]), those are returned — they represent the precise
///    GPS location of the truck entrance and should be preferred for
///    marker placement.
/// 2. Otherwise the property-centre coordinate ([PoiItem.lat] /
///    [PoiItem.lng]) is returned.
///
/// Under **no circumstances** should [snapToRoad] be called inside display
/// code.  Snapping moves the pin to the nearest road vertex, which may place
/// the marker on the wrong road or inside a highway divider — far from the
/// real entrance.  Route-snapping is a logic operation, not a display one.
///
/// ### Usage
///
/// ```dart
/// // ✅ Correct: use the real entrance / centre coordinate for the marker.
/// final LatLng markerPos = getPoiDisplayLocation(poi);
/// addMarker(markerPos);
///
/// // ❌ Wrong: snapping the POI for display moves the pin off the property.
/// // final snapped = snapToRoad(LatLng(poi.lat, poi.lng), routePoints);
/// // addMarker(snapped.snappedPoint);
/// ```
///
/// For route-logic purposes (filtering, on-route checks, distance ranking)
/// call [snapToRoad] or [isOnRoute] separately — those helpers carry both
/// the snapped and the source coordinates so you can always render from the
/// source.
LatLng getPoiDisplayLocation(PoiItem poi) {
  // 1. Prefer verified entrance coordinates when available — they are the
  //    most accurate truck-entrance GPS fix for this property.
  if (poi.entranceLat != null && poi.entranceLng != null) {
    return LatLng(poi.entranceLat!, poi.entranceLng!);
  }

  // 2. Fallback: property-centre coordinate stored in the JSON.
  //    Never snap this to the road — use it as-is.
  return LatLng(poi.lat, poi.lng);
}

/// A minimal POI (Point of Interest) model used by [filterPOIsNearRoute].
///
/// In production, substitute your actual domain model
/// (e.g. `MapPoi`, `TruckStopPoi`, or `WeighStationPoi`) and adapt the
/// field accessors inside [filterPOIsNearRoute] accordingly.
class RoutePoi {
  const RoutePoi({
    required this.id,
    required this.lat,
    required this.lng,
    this.name = '',
  });

  /// Unique identifier for this POI.
  final String id;

  /// Latitude of the POI in decimal degrees.
  final double lat;

  /// Longitude of the POI in decimal degrees.
  final double lng;

  /// Human-readable name (optional, for display/debugging).
  final String name;
}

/// Returns only those [allPOIs] that lie within [maxDistanceMeters] of any
/// point along the [routePoints] polyline.
///
/// ### Algorithm
/// For each POI the function iterates over every route point and computes the
/// straight-line surface distance using [Geolocator.distanceBetween] (WGS-84
/// haversine formula).  As soon as **one** route point is found within the
/// threshold the POI is accepted and the inner loop exits early – avoiding
/// unnecessary distance calculations for the remaining route points.
///
/// ### Parameters
/// - [allPOIs]            – Complete list of candidate POIs.
/// - [routePoints]        – Ordered list of [LatLng] vertices that make up the
///                          route polyline.
/// - [maxDistanceMeters]  – Inclusion radius in metres (default **10 000 m /
///                          10 km**).  Pass a custom value to widen or narrow
///                          the corridor.
///
/// ### Returns
/// A new [List<RoutePoi>] containing only the POIs within the specified
/// distance of the route.  Order is preserved from [allPOIs].
/// Returns an empty list when either [allPOIs] or [routePoints] is empty.
///
/// ### Complexity
/// O(n × m) in the worst case, where *n* = `allPOIs.length` and
/// *m* = `routePoints.length`.  The early-exit optimisation means that
/// POIs close to the start of the route are accepted after very few
/// distance calculations.
///
/// ### Example
/// ```dart
/// final nearby = filterPOIsNearRoute(
///   allRestAreas,
///   activeRoutePoints,
///   maxDistanceMeters: 5000, // 5 km corridor
/// );
/// ```
List<RoutePoi> filterPOIsNearRoute(
  List<RoutePoi> allPOIs,
  List<LatLng> routePoints, {
  double maxDistanceMeters = 10000, // default: 10 km
}) {
  // Nothing to do if either list is empty.
  if (allPOIs.isEmpty || routePoints.isEmpty) return [];

  final List<RoutePoi> filtered = [];

  for (final RoutePoi poi in allPOIs) {
    for (final LatLng point in routePoints) {
      // Compute surface distance (metres) between the POI and this route point.
      final double distance = Geolocator.distanceBetween(
        poi.lat,
        poi.lng,
        point.latitude,
        point.longitude,
      );

      // Early exit: once the POI is within range there is no need to check
      // the remaining route points for this POI.
      if (distance <= maxDistanceMeters) {
        filtered.add(poi);
        break;
      }
    }
  }

  return filtered;
}

// ── Route-based POI filter for PoiItem ────────────────────────────────────

/// Returns only those [pois] (loaded from `assets/locations.json`) that lie
/// within [proximityMeters] of **any** point along the [routePoints] polyline.
///
/// This is the primary driver-facing filter: call it before building map
/// markers so that only POIs relevant to the active route are rendered.
///
/// ### Algorithm
/// For every [PoiItem] the function checks the straight-line surface distance
/// from the POI's best-available display coordinate ([PoiItem.displayLat] /
/// [PoiItem.displayLng]) to each vertex in [routePoints] using the WGS-84
/// haversine formula provided by [Geolocator.distanceBetween].  The inner
/// loop exits as soon as one route point qualifies, so the worst-case
/// O(n × m) cost is only reached when every POI is off-route.
///
/// ### Parameters
/// - [pois]              – All candidate [PoiItem]s (e.g. from `loadAllPois()`).
/// - [routePoints]       – Ordered [LatLng] vertices of the active route
///                         polyline (pass a sub-list starting at the truck's
///                         current index to restrict checking to the
///                         _ahead-on-route_ portion only).
/// - [proximityMeters]   – Corridor half-width in metres.  Defaults to
///                         **200 m**.  Increase this value to widen the
///                         corridor (e.g. `proximityMeters: 2000` for a 2 km
///                         buffer suitable for highway routes); decrease it
///                         for city driving where only roadside POIs matter.
///                         The constant [kDefaultPoiProximityMeters] is
///                         provided for a named reference.
///
/// ### Returns
/// A new `List<PoiItem>` preserving the original order of [pois].  Returns
/// an empty list when [pois] or [routePoints] is empty.
///
/// ### turf_dart (optional enhancement)
/// The current implementation uses point-to-vertex sampling which is accurate
/// enough for densely-sampled Mapbox routes (waypoints every ~10–50 m).
/// If your route is coarser, consider replacing the inner loop with
/// `turf_dart`'s `nearestPointOnLine` for true point-to-segment distance:
///
/// ```yaml
/// # pubspec.yaml
/// dependencies:
///   turf: ^0.0.9   # turf_dart – add if segment-level precision is needed
/// ```
///
/// ### Example
/// ```dart
/// // Show POIs within 500 m of the route ahead of the truck:
/// final ahead = _routePoints.sublist(_truckIndex);
/// final nearbyPois = getPOIsOnRoute(
///   _loadedPois,
///   ahead,
///   proximityMeters: 500,
/// );
/// ```
///
/// To adjust the default threshold for the whole app, change
/// [kDefaultPoiProximityMeters] or pass a custom value at the call site.
const double kDefaultPoiProximityMeters = 200.0;

List<PoiItem> getPOIsOnRoute(
  List<PoiItem> pois,
  List<LatLng> routePoints, {
  // Proximity threshold in metres.  Increase for wider corridors (e.g. 2000
  // for highways) or decrease for tighter, city-scale filtering.
  double proximityMeters = kDefaultPoiProximityMeters,
}) {
  // Nothing to filter when inputs are empty.
  if (pois.isEmpty || routePoints.isEmpty) return const [];

  final List<PoiItem> filtered = [];

  for (final PoiItem poi in pois) {
    // Use the best-available display coordinate (entrance point if known,
    // otherwise the property centre).
    final double poiLat = poi.displayLat;
    final double poiLng = poi.displayLng;

    for (final LatLng routePoint in routePoints) {
      final double distanceMeters = Geolocator.distanceBetween(
        poiLat,
        poiLng,
        routePoint.latitude,
        routePoint.longitude,
      );

      // Early exit: the POI qualifies as soon as one route point is within
      // the threshold — no need to check the remaining vertices.
      if (distanceMeters <= proximityMeters) {
        filtered.add(poi);
        break;
      }
    }
  }

  return filtered;
}

/// Returns the best-available [LatLng] for rendering a POI marker on the map.
///
/// Priority:
///   1. Exact entrance coordinates ([PoiItem.entranceLat] /
///      [PoiItem.entranceLng]) when present — the verified GPS fix at the
///      facility's primary truck access point.
///   2. The stored property-centre coordinates ([PoiItem.lat] /
///      [PoiItem.lng]) as a fallback.
///
/// **Road snapping is never applied.**  Map marker placement must always use
/// real, stored coordinates — not a point projected onto the nearest road
/// segment.  Route snapping may only be used for filtering, ranking, or
/// determining "ahead-on-route" status, never for visual marker position.
LatLng getDisplayLocation(PoiItem poi) {
  if (poi.entranceLat != null && poi.entranceLng != null) {
    return LatLng(poi.entranceLat!, poi.entranceLng!);
  }
  return LatLng(poi.lat, poi.lng);
}
