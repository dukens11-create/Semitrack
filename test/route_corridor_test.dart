import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/utils/route_corridor.dart';

void main() {
  const route = <LatLng>[
    LatLng(39.5000, -119.8000),
    LatLng(39.5100, -119.8000),
    LatLng(39.5100, -119.7900),
  ];

  test('matches a warning located on the selected route', () {
    final projection = projectPointToRoute(
      const LatLng(39.5050, -119.8000),
      route,
    );

    expect(projection, isNotNull);
    expect(projection!.distanceMeters, lessThan(1));
    expect(projection.segmentIndex, 0);
    expect(projection.segmentFraction, closeTo(0.5, 0.01));
  });

  test('keeps a side-road warning outside a tight route corridor', () {
    final projection = projectPointToRoute(
      const LatLng(39.5050, -119.7994),
      route,
    );

    expect(projection, isNotNull);
    expect(projection!.distanceMeters, greaterThan(45));
  });

  test('clamps projection to a real segment endpoint', () {
    final projection = projectPointToRoute(
      const LatLng(39.4990, -119.8000),
      route,
    );

    expect(projection, isNotNull);
    expect(projection!.segmentFraction, 0);
    expect(projection.routeOffsetMeters, 0);
    expect(projection.distanceMeters, greaterThan(100));
  });

  test('reports increasing distance along the route', () {
    final first = projectPointToRoute(const LatLng(39.5050, -119.8000), route);
    final second = projectPointToRoute(const LatLng(39.5100, -119.7950), route);

    expect(second!.routeOffsetMeters, greaterThan(first!.routeOffsetMeters));
    expect(second.segmentIndex, 1);
  });
}
