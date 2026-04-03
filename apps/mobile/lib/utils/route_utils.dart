import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

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
