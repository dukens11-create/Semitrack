import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

/// The closest, bounded projection of a point onto a route polyline.
class RouteProjection {
  const RouteProjection({
    required this.distanceMeters,
    required this.routeOffsetMeters,
    required this.segmentIndex,
    required this.segmentFraction,
    required this.projectedPoint,
  });

  /// Perpendicular distance from the source point to the route segment.
  final double distanceMeters;

  /// Distance from the beginning of the route to [projectedPoint].
  final double routeOffsetMeters;

  /// Index of the first point in the matched route segment.
  final int segmentIndex;

  /// Position along the matched segment, clamped to 0...1.
  final double segmentFraction;

  final LatLng projectedPoint;
}

/// Projects [point] onto the nearest *bounded* segment in [route].
///
/// A bounded projection prevents a warning beside the infinite extension of a
/// route segment from being treated as on-route. This is especially important
/// for stop signs and signals on side roads near an intersection.
RouteProjection? projectPointToRoute(LatLng point, List<LatLng> route) {
  if (route.isEmpty) return null;
  if (route.length == 1) {
    return RouteProjection(
      distanceMeters: _distanceMeters(point, route.first),
      routeOffsetMeters: 0,
      segmentIndex: 0,
      segmentFraction: 0,
      projectedPoint: route.first,
    );
  }

  final double cosLat = math.cos(point.latitude * math.pi / 180.0);
  double cumulativeMeters = 0;
  RouteProjection? best;

  for (int i = 0; i < route.length - 1; i++) {
    final LatLng a = route[i];
    final LatLng b = route[i + 1];
    final double segmentMeters = _distanceMeters(a, b);

    final double abLat = (b.latitude - a.latitude) * 110540.0;
    final double abLng = (b.longitude - a.longitude) * 111320.0 * cosLat;
    final double apLat = (point.latitude - a.latitude) * 110540.0;
    final double apLng = (point.longitude - a.longitude) * 111320.0 * cosLat;
    final double abSquared = abLat * abLat + abLng * abLng;
    final double fraction = abSquared < 1e-10
        ? 0.0
        : ((apLat * abLat + apLng * abLng) / abSquared)
              .clamp(0.0, 1.0)
              .toDouble();
    final LatLng projected = LatLng(
      a.latitude + fraction * (b.latitude - a.latitude),
      a.longitude + fraction * (b.longitude - a.longitude),
    );
    final double distance = _distanceMeters(point, projected);

    if (best == null || distance < best.distanceMeters) {
      best = RouteProjection(
        distanceMeters: distance,
        routeOffsetMeters: cumulativeMeters + segmentMeters * fraction,
        segmentIndex: i,
        segmentFraction: fraction,
        projectedPoint: projected,
      );
    }
    cumulativeMeters += segmentMeters;
  }

  return best;
}

double _distanceMeters(LatLng a, LatLng b) {
  const double earthRadiusMeters = 6371000;
  final double lat1 = a.latitude * math.pi / 180.0;
  final double lat2 = b.latitude * math.pi / 180.0;
  final double deltaLat = (b.latitude - a.latitude) * math.pi / 180.0;
  final double deltaLng = (b.longitude - a.longitude) * math.pi / 180.0;
  final double sinLat = math.sin(deltaLat / 2);
  final double sinLng = math.sin(deltaLng / 2);
  final double h =
      (sinLat * sinLat + math.cos(lat1) * math.cos(lat2) * sinLng * sinLng)
          .clamp(0.0, 1.0)
          .toDouble();
  return earthRadiusMeters * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h));
}
