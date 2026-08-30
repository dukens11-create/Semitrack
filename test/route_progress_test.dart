import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/models/route_progress.dart';

void main() {
  test('remaining route distance decreases smoothly between vertices', () {
    const route = [LatLng(0, 0), LatLng(0, 0.01), LatLng(0, 0.02)];

    final atStart = remainingRouteMeters(route: route, current: route.first);
    final halfway = remainingRouteMeters(
      route: route,
      current: const LatLng(0, 0.005),
    );
    final nearEnd = remainingRouteMeters(
      route: route,
      current: const LatLng(0, 0.019),
      currentRouteIndex: 2,
    );

    expect(atStart, closeTo(2224, 20));
    expect(halfway, closeTo(1668, 20));
    expect(nearEnd, closeTo(111, 10));
    expect(atStart, greaterThan(halfway));
    expect(halfway, greaterThan(nearEnd));
  });

  test('remaining distance reaches exactly zero at the terminal point', () {
    const route = [LatLng(39, -120), LatLng(40, -119)];

    expect(
      remainingRouteMeters(
        route: route,
        current: route.last,
        currentRouteIndex: 1,
      ),
      closeTo(0, 0.001),
    );
  });

  test('route match projects onto a segment and reports cross-track error', () {
    const route = [LatLng(0, 0), LatLng(0, 0.01), LatLng(0, 0.02)];

    final match = matchRoutePosition(
      route: route,
      current: const LatLng(0.001, 0.005),
    );

    expect(match, isNotNull);
    expect(match!.segmentIndex, 0);
    expect(match.segmentFraction, closeTo(0.5, 0.01));
    expect(match.projectedPoint.latitude, closeTo(0, 0.000001));
    expect(match.projectedPoint.longitude, closeTo(0.005, 0.000001));
    expect(match.crossTrackMeters, closeTo(111, 3));
    expect(match.nearestRoutePointIndex, 1);
  });

  test('bounded matching cannot jump to a distant crossing route section', () {
    final route = <LatLng>[
      const LatLng(0, 0),
      const LatLng(0, 0.01),
      for (var index = 1; index <= 40; index++) LatLng(index * 0.001, 0.01),
      const LatLng(0, 0),
      const LatLng(0, -0.01),
    ];

    final match = matchRoutePosition(
      route: route,
      current: const LatLng(0.00005, 0.0001),
      currentRouteIndex: 0,
      backwardSegmentWindow: 0,
      forwardSegmentWindow: 10,
    );

    expect(match, isNotNull);
    expect(match!.segmentIndex, 0);
    expect(match.nearestRoutePointIndex, 0);
  });
}
