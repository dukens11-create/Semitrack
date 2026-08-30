import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/models/weigh_station.dart';
import 'package:semitrack_mobile/services/weigh_station_repository.dart';

WeighStation station({
  required String id,
  required double lat,
  required double lng,
  String? direction,
}) =>
    WeighStation(
      id: id,
      name: 'Test enforcement facility',
      state: 'OR',
      position: LatLng(lat, lng),
      highway: 'I-84',
      direction: direction,
      type: WeighStationType.fixedWeighStation,
      status: WeighStationStatus.unknown,
      officialSourceName: 'Test fixture only',
      officialSourceUrl: 'https://example.test/source',
      isOfficial: true,
      isActive: true,
      createdAt: DateTime.utc(2026),
      updatedAt: DateTime.utc(2026),
    );

void main() {
  test('parses the production station schema', () {
    final parsed = WeighStation.fromJson({
      'id': 'or-fixture-1',
      'name': 'Fixture Port of Entry',
      'state': 'OR',
      'latitude': 45.0,
      'longitude': -120.0,
      'type': 'PORT_OF_ENTRY',
      'status': 'INSPECTION',
      'officialSourceName': 'Test fixture',
      'officialSourceUrl': 'https://example.test/source',
      'isOfficial': true,
      'isActive': true,
      'createdAt': '2026-01-01T00:00:00Z',
      'updatedAt': '2026-01-01T00:00:00Z',
    });
    expect(parsed.type, WeighStationType.portOfEntry);
    expect(parsed.status, WeighStationStatus.inspection);
  });

  test('rejects invalid coordinates and source URLs', () {
    expect(
      () => WeighStation.fromJson({
        'id': 'bad',
        'name': 'Bad fixture',
        'state': 'OR',
        'latitude': 200,
        'longitude': -120,
        'type': 'FIXED_WEIGH_STATION',
        'officialSourceName': 'Fixture',
        'officialSourceUrl': 'not-a-url',
        'createdAt': '2026-01-01T00:00:00Z',
        'updatedAt': '2026-01-01T00:00:00Z',
      }),
      throwsFormatException,
    );
  });

  test('route matching sorts encounter order and excludes opposite direction',
      () {
    final repository = WeighStationRepository();
    final route = const [
      LatLng(40, -120),
      LatLng(40, -119),
      LatLng(41, -119),
    ];
    final matches = repository.getStationsAlongRoute([
      station(id: 'later', lat: 40.8, lng: -119.001, direction: 'NB'),
      station(id: 'first', lat: 40.001, lng: -119.5, direction: 'EB'),
      station(id: 'opposite', lat: 40.002, lng: -119.4, direction: 'WB'),
      station(id: 'far', lat: 41.5, lng: -118),
    ], route, maxCorridorMeters: 1000, routeBearing: 90);
    expect(matches.map((match) => match.station.id), ['first']);
  });

  test('next station respects current route progress', () {
    final repository = WeighStationRepository();
    final route = const [LatLng(40, -120), LatLng(40, -119)];
    final first = station(id: 'first', lat: 40, lng: -119.8);
    final second = station(id: 'second', lat: 40, lng: -119.2);
    final initial = repository.getNextStationAhead([second, first], route);
    expect(initial?.station.id, 'first');
    final afterFirst = repository.getNextStationAhead(
      [second, first],
      route,
      currentRouteOffsetMeters: 50000,
    );
    expect(afterFirst?.station.id, 'second');
  });
}
