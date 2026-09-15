import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/services/authoritative_stop_plan.dart';

const origin = AuthoritativeRouteStop(id: 'origin', latitude: 1, longitude: 1);
const stopA = AuthoritativeRouteStop(id: 'a', latitude: 2, longitude: 2);
const stopB = AuthoritativeRouteStop(id: 'b', latitude: 3, longitude: 3);
const destination = AuthoritativeRouteStop(
  id: 'destination',
  latitude: 4,
  longitude: 4,
);

void main() {
  test('origin to destination has no intermediate stop', () {
    final plan = AuthoritativeStopPlan(destination: destination);
    expect(plan.routeStopsFrom(origin).map((item) => item.id), [
      'origin',
      'destination',
    ]);
  });

  test('one and two stop routes preserve authoritative order', () {
    final plan = AuthoritativeStopPlan(destination: destination)
      ..add(stopA)
      ..add(stopB);
    expect(plan.routeStopsFrom(origin).map((item) => item.id), [
      'origin',
      'a',
      'b',
      'destination',
    ]);
  });

  test('remove and reorder update the same route plan', () {
    final plan = AuthoritativeStopPlan(destination: destination)
      ..add(stopA)
      ..add(stopB);
    plan.reorder(1, 0);
    expect(plan.intermediateStops.map((item) => item.id), ['b', 'a']);
    expect(plan.remove('a'), isTrue);
    expect(plan.intermediateStops.map((item) => item.id), ['b']);
  });

  test(
    'reroute before a stop keeps it and arrival removes only the next stop',
    () {
      final plan = AuthoritativeStopPlan(destination: destination)
        ..add(stopA)
        ..add(stopB);
      expect(plan.routeStopsFrom(origin).map((item) => item.id), [
        'origin',
        'a',
        'b',
        'destination',
      ]);
      expect(plan.markIntermediateArrived('b'), isFalse);
      expect(plan.markIntermediateArrived('a'), isTrue);
      expect(plan.routeStopsFrom(origin).map((item) => item.id), [
        'origin',
        'b',
        'destination',
      ]);
    },
  );
}
