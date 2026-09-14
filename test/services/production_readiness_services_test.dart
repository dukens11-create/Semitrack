import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/services/arrival_detector.dart';
import 'package:semitrack_mobile/services/location_sampling_policy.dart';
import 'package:semitrack_mobile/services/multi_stop_manager.dart';
import 'package:semitrack_mobile/services/navigation_telemetry.dart';
import 'package:semitrack_mobile/services/route_retry_policy.dart';
import 'package:semitrack_mobile/services/traffic_refresh_policy.dart';

void main() {
  test('unsafe traffic candidate never replaces active route', () {
    const policy = TrafficRefreshPolicy(minimumSavings: Duration.zero, minimumSavingsRatio: 0);
    const current = TrafficRouteCandidate(truckSafe: true, navigationAllowed: true, etaSeconds: 1000, routeId: 'a');
    const unsafe = TrafficRouteCandidate(truckSafe: false, navigationAllowed: true, etaSeconds: 100, routeId: 'b');
    expect(policy.shouldReplace(current: current, candidate: unsafe), isFalse);
  });

  test('arrival requires dwell and final route confidence', () {
    final detector = ArrivalDetector(requiredDwell: const Duration(seconds: 8));
    final t = DateTime.utc(2026, 9, 13);
    expect(detector.update(ArrivalSample(destinationDistanceMeters: 10, remainingRouteMeters: 20, speedMps: 1, onFinalRouteSegment: true, timestamp: t)), isFalse);
    expect(detector.update(ArrivalSample(destinationDistanceMeters: 10, remainingRouteMeters: 20, speedMps: 1, onFinalRouteSegment: true, timestamp: t.add(const Duration(seconds: 9)))), isTrue);
  });

  test('multi stop manager is deterministic', () {
    final manager = MultiStopManager<String>([const NavigationStop(id: 'a', value: 'A'), const NavigationStop(id: 'b', value: 'B')]);
    manager.reorder(1, 0);
    expect(manager.nextStop?.id, 'b');
    expect(manager.skip('b'), isTrue);
    expect(manager.nextStop?.id, 'a');
  });

  test('retry policy retries transient failures only', () {
    const policy = RouteRetryPolicy();
    expect(policy.canRetry(attempt: 1, statusCode: 503), isTrue);
    expect(policy.canRetry(attempt: 1, statusCode: 400), isFalse);
    expect(policy.canRetry(attempt: 3, statusCode: 503), isFalse);
  });

  test('browsing sampling is less aggressive than navigation', () {
    const policy = LocationSamplingPolicy();
    expect(policy.forState(NavigationMotionState.browsing).interval, greaterThan(policy.forState(NavigationMotionState.navigatingHighway).interval));
  });

  test('telemetry drops sensitive fields', () {
    Map<String, Object?>? captured;
    final telemetry = NavigationTelemetry((event) => captured = event);
    telemetry.record('route', {'provider': 'trimble', 'latitude': 1.2, 'authToken': 'secret', 'durationMs': 10});
    expect(captured?['provider'], 'trimble');
    expect(captured?['durationMs'], 10);
    expect(captured?.containsKey('latitude'), isFalse);
    expect(captured?.containsKey('authToken'), isFalse);
  });
}
