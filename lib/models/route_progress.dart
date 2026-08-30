import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

const double _earthRadiusMeters = 6371008.8;

/// A single, internally consistent match between a GPS fix and route geometry.
///
/// Consumers should use this result for marker snapping, route progress, and
/// off-route distance instead of independently searching the full polyline.
/// The bounded search prevents a fix near a crossing or parallel road from
/// jumping to a much later section of the route.
class RouteMatch {
  const RouteMatch({
    required this.projectedPoint,
    required this.segmentIndex,
    required this.segmentFraction,
    required this.crossTrackMeters,
    required this.distanceAlongRouteMeters,
    required this.remainingRouteMeters,
    required this.nearestRoutePointIndex,
  });

  final LatLng projectedPoint;
  final int segmentIndex;
  final double segmentFraction;
  final double crossTrackMeters;
  final double distanceAlongRouteMeters;
  final double remainingRouteMeters;
  final int nearestRoutePointIndex;
}

/// Projects [current] onto a bounded window around [currentRouteIndex].
///
/// A small backward window tolerates normal GPS jitter without allowing route
/// progress to rewind. The forward window is large enough for sparse route
/// geometry and ordinary GPS gaps, but deliberately excludes distant route
/// sections that happen to cross the truck's current road.
RouteMatch? matchRoutePosition({
  required List<LatLng> route,
  required LatLng current,
  int currentRouteIndex = 0,
  int backwardSegmentWindow = 2,
  int forwardSegmentWindow = 24,
}) {
  if (route.isEmpty) return null;
  if (route.length == 1) {
    final distance = _haversineMeters(current, route.first);
    return RouteMatch(
      projectedPoint: route.first,
      segmentIndex: 0,
      segmentFraction: 0,
      crossTrackMeters: distance,
      distanceAlongRouteMeters: 0,
      remainingRouteMeters: distance,
      nearestRoutePointIndex: 0,
    );
  }

  final lastSegment = route.length - 2;
  final safeCurrentIndex = currentRouteIndex.clamp(0, route.length - 1);
  final firstSegment = (safeCurrentIndex - backwardSegmentWindow)
      .clamp(0, lastSegment)
      .toInt();
  final searchEnd = (safeCurrentIndex + forwardSegmentWindow)
      .clamp(firstSegment, lastSegment)
      .toInt();

  var bestSegment = firstSegment;
  var bestFraction = 0.0;
  var bestDistanceSquared = double.infinity;
  var bestProjectedPoint = route[firstSegment];
  for (var index = firstSegment; index <= searchEnd; index++) {
    final projection = _projectOnSegment(
      current,
      route[index],
      route[index + 1],
    );
    if (projection.distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = projection.distanceSquared;
      bestSegment = index;
      bestFraction = projection.fraction;
      bestProjectedPoint = projection.projectedPoint;
    }
  }

  var distanceAlong = 0.0;
  for (var index = 0; index < bestSegment; index++) {
    distanceAlong += _haversineMeters(route[index], route[index + 1]);
  }
  final matchedSegmentMeters = _haversineMeters(
    route[bestSegment],
    route[bestSegment + 1],
  );
  distanceAlong += matchedSegmentMeters * bestFraction;

  var remaining = matchedSegmentMeters * (1 - bestFraction);
  for (var index = bestSegment + 1; index < route.length - 1; index++) {
    remaining += _haversineMeters(route[index], route[index + 1]);
  }

  return RouteMatch(
    projectedPoint: bestProjectedPoint,
    segmentIndex: bestSegment,
    segmentFraction: bestFraction,
    crossTrackMeters: _haversineMeters(current, bestProjectedPoint),
    distanceAlongRouteMeters: math.max(0, distanceAlong),
    remainingRouteMeters: math.max(0, remaining),
    nearestRoutePointIndex: bestFraction < 0.5 ? bestSegment : bestSegment + 1,
  );
}

/// Returns the remaining distance from [current] to the end of [route].
///
/// The current point is projected onto a small forward window of route
/// segments, producing smooth progress between polyline vertices while avoiding
/// accidental jumps to a later road where a long route crosses itself.
double remainingRouteMeters({
  required List<LatLng> route,
  required LatLng current,
  int currentRouteIndex = 0,
  int forwardSegmentWindow = 12,
}) {
  return matchRoutePosition(
        route: route,
        current: current,
        currentRouteIndex: currentRouteIndex,
        forwardSegmentWindow: forwardSegmentWindow,
      )?.remainingRouteMeters ??
      0;
}

({double fraction, double distanceSquared, LatLng projectedPoint})
_projectOnSegment(LatLng point, LatLng start, LatLng end) {
  final referenceLatitude =
      ((point.latitude + start.latitude + end.latitude) / 3) * math.pi / 180;
  final scaleX = math.cos(referenceLatitude);
  final px = point.longitude * scaleX;
  final py = point.latitude;
  final ax = start.longitude * scaleX;
  final ay = start.latitude;
  final bx = end.longitude * scaleX;
  final by = end.latitude;
  final dx = bx - ax;
  final dy = by - ay;
  final lengthSquared = dx * dx + dy * dy;
  final fraction = lengthSquared == 0
      ? 0.0
      : (((px - ax) * dx + (py - ay) * dy) / lengthSquared)
            .clamp(0.0, 1.0)
            .toDouble();
  final projectedX = ax + fraction * dx;
  final projectedY = ay + fraction * dy;
  final offsetX = px - projectedX;
  final offsetY = py - projectedY;
  return (
    fraction: fraction,
    distanceSquared: offsetX * offsetX + offsetY * offsetY,
    projectedPoint: LatLng(
      start.latitude + fraction * (end.latitude - start.latitude),
      start.longitude + fraction * (end.longitude - start.longitude),
    ),
  );
}

double _haversineMeters(LatLng first, LatLng second) {
  final lat1 = first.latitude * math.pi / 180;
  final lat2 = second.latitude * math.pi / 180;
  final deltaLat = (second.latitude - first.latitude) * math.pi / 180;
  final deltaLng = (second.longitude - first.longitude) * math.pi / 180;
  final a =
      math.sin(deltaLat / 2) * math.sin(deltaLat / 2) +
      math.cos(lat1) *
          math.cos(lat2) *
          math.sin(deltaLng / 2) *
          math.sin(deltaLng / 2);
  return _earthRadiusMeters * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}
