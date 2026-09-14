import 'dart:math' as math;

class ArrivalSample {
  const ArrivalSample({required this.destinationDistanceMeters, required this.remainingRouteMeters, required this.speedMps, this.headingDeltaDegrees, required this.onFinalRouteSegment, required this.timestamp});
  final double destinationDistanceMeters;
  final double remainingRouteMeters;
  final double speedMps;
  final double? headingDeltaDegrees;
  final bool onFinalRouteSegment;
  final DateTime timestamp;
}

/// Conservative arrival confirmation designed to avoid parallel-road and
/// drive-by false positives. A single close GPS point never completes a trip.
class ArrivalDetector {
  ArrivalDetector({this.radiusMeters = 35, this.routeRemainingMeters = 70, this.maxSpeedMps = 3.0, this.requiredDwell = const Duration(seconds: 8)});
  final double radiusMeters;
  final double routeRemainingMeters;
  final double maxSpeedMps;
  final Duration requiredDwell;
  DateTime? _candidateSince;

  bool update(ArrivalSample s) {
    final headingOk = s.headingDeltaDegrees == null || _normalizedHeadingDelta(s.headingDeltaDegrees!) <= 80;
    final candidate = s.onFinalRouteSegment && s.destinationDistanceMeters <= radiusMeters && s.remainingRouteMeters <= routeRemainingMeters && s.speedMps <= maxSpeedMps && headingOk;
    if (!candidate) { _candidateSince = null; return false; }
    _candidateSince ??= s.timestamp;
    return s.timestamp.difference(_candidateSince!) >= requiredDwell;
  }
  void reset() => _candidateSince = null;
  double _normalizedHeadingDelta(double value) {
    final v = value.abs() % 360;
    return math.min(v, 360 - v);
  }
}
