import 'package:semitrack_mobile/core/api_client.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

class DestinationTimeZone {
  DestinationTimeZone({required this.name, required this.utcOffset}) {
    _ensureTimeZonesInitialized();
    try {
      _location = tz.getLocation(name);
    } on ArgumentError {
      _location = null;
    }
  }

  final String name;
  final String utcOffset;
  tz.Location? _location;

  static bool _timeZonesInitialized = false;

  static void _ensureTimeZonesInitialized() {
    if (_timeZonesInitialized) return;
    tz_data.initializeTimeZones();
    _timeZonesInitialized = true;
  }

  DateTime localTimeAt(DateTime instant) {
    final utc = instant.toUtc();
    final location = _location;
    if (location != null) return tz.TZDateTime.from(utc, location);
    return utc.add(_parseUtcOffset(utcOffset));
  }

  String abbreviationAt(DateTime instant) {
    final location = _location;
    if (location != null) {
      return tz.TZDateTime.from(instant.toUtc(), location).timeZoneName;
    }
    return 'UTC$utcOffset';
  }

  int dayOffsetAt(DateTime arrivalInstant, {DateTime? now}) {
    final destinationNow = localTimeAt(now ?? DateTime.now());
    final destinationArrival = localTimeAt(arrivalInstant);
    final startDay = DateTime.utc(
      destinationNow.year,
      destinationNow.month,
      destinationNow.day,
    );
    final arrivalDay = DateTime.utc(
      destinationArrival.year,
      destinationArrival.month,
      destinationArrival.day,
    );
    return arrivalDay.difference(startDay).inDays;
  }
}

class DestinationTimeZoneService {
  const DestinationTimeZoneService(this._api);

  final ApiClient _api;

  Future<DestinationTimeZone> resolve({
    required double latitude,
    required double longitude,
  }) async {
    final query = Uri(
      queryParameters: {
        'lat': latitude.toString(),
        'lng': longitude.toString(),
      },
    ).query;
    final response = await _api.getJson('/location/timezone?$query');
    return DestinationTimeZone(
      name: response['name']?.toString() ?? '',
      utcOffset: response['utcOffset']?.toString() ?? '+00:00',
    );
  }
}

Duration _parseUtcOffset(String value) {
  final match = RegExp(r'^([+-])(\d{2}):(\d{2})$').firstMatch(value);
  if (match == null) return Duration.zero;
  final minutes = int.parse(match.group(2)!) * 60 + int.parse(match.group(3)!);
  return Duration(minutes: match.group(1) == '-' ? -minutes : minutes);
}
