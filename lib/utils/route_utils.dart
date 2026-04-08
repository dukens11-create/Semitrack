import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/models/poi_item.dart';

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
