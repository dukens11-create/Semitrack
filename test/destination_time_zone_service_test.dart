import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/services/destination_time_zone_service.dart';

void main() {
  group('DestinationTimeZone', () {
    test('uses IANA daylight-saving rules at the arrival instant', () {
      final zone = DestinationTimeZone(
        name: 'America/Los_Angeles',
        utcOffset: '-08:00',
      );

      final summer = zone.localTimeAt(DateTime.utc(2026, 7, 1, 12));
      final winter = zone.localTimeAt(DateTime.utc(2026, 1, 1, 12));

      expect(summer.hour, 5);
      expect(zone.abbreviationAt(DateTime.utc(2026, 7, 1, 12)), 'PDT');
      expect(winter.hour, 4);
      expect(zone.abbreviationAt(DateTime.utc(2026, 1, 1, 12)), 'PST');
    });

    test('reports arrival day offset in the destination calendar', () {
      final zone = DestinationTimeZone(
        name: 'America/New_York',
        utcOffset: '-05:00',
      );
      final now = DateTime.utc(2026, 1, 1, 20);
      final arrival = DateTime.utc(2026, 1, 2, 7);

      expect(zone.dayOffsetAt(arrival, now: now), 1);
    });
  });
}
