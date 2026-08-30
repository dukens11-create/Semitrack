import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/live_road_data.dart';

void main() {
  test('parses live parking availability with explicit provenance', () {
    final parking = LiveParkingLocation.fromJson({
      'id': 'parking-1',
      'name': 'Official truck parking area',
      'latitude': 45.1,
      'longitude': -122.2,
      'routeDistanceAheadMeters': 4200,
      'totalTruckSpaces': 32,
      'currentAvailability': {
        'value': 'AVAILABLE',
        'source': 'OREGON_DOT',
        'confidence': 0.92,
        'lastReportedAt': '2026-08-20T10:00:00Z',
      },
    });

    expect(parking.availability, 'AVAILABLE');
    expect(parking.source, 'OREGON_DOT');
    expect(parking.confidence, 0.92);
    expect(parking.totalTruckSpaces, 32);
    expect(parking.lastReportedAt, DateTime.utc(2026, 8, 20, 10));
  });

  test('parses decimal fuel prices and preserves freshness metadata', () {
    final station = LiveDieselStation.fromJson({
      'id': 'fuel-1',
      'name': 'Truck fuel stop',
      'latitude': 39.5,
      'longitude': -104.9,
      'routeDistanceAheadMeters': 1800,
      'prices': [
        {
          'cashPrice': '3.759',
          'creditPrice': 3.829,
          'observedAt': '2026-08-20T09:30:00Z',
          'source': 'PARTNER_FEED',
          'confidence': 0.88,
          'verified': true,
        },
      ],
    });

    expect(station.cashPrice, 3.759);
    expect(station.creditPrice, 3.829);
    expect(station.source, 'PARTNER_FEED');
    expect(station.confidence, 0.88);
    expect(station.verified, isTrue);
    expect(station.observedAt, DateTime.utc(2026, 8, 20, 9, 30));
  });
}
