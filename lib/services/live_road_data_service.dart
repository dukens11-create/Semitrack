import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/core/api_client.dart';
import 'package:semitrack_mobile/models/live_road_data.dart';

class LiveRoadDataService {
  const LiveRoadDataService(this.api);
  final ApiClient api;

  Future<DriverSafetySnapshot> loadCorridor({
    required List<LatLng> route,
    double currentRouteOffsetMeters = 0,
    double maxDistanceAheadMeters = 160934,
    double? routeBearing,
  }) async {
    final body = <String, dynamic>{
      'route': route
          .map((point) => {'lat': point.latitude, 'lng': point.longitude})
          .toList(growable: false),
      'currentRouteOffsetMeters': currentRouteOffsetMeters,
      'maxDistanceAheadMeters': maxDistanceAheadMeters,
      'routeBearing': routeBearing,
      'limit': 50,
    };
    final errors = <String>[];
    List<T> parse<T>(
      Map<String, dynamic>? response,
      T Function(Map<String, dynamic>) mapper,
    ) => (response?['items'] as List? ?? const [])
        .map((value) => mapper(value as Map<String, dynamic>))
        .toList(growable: false);

    Future<Map<String, dynamic>?> request(String path) async {
      try {
        return await api.postJson(path, body);
      } catch (error) {
        errors.add('$path: $error');
        return null;
      }
    }

    final responses = await Future.wait([
      request('/safety/restrictions/corridor'),
      request('/safety/road-events/corridor'),
      request('/safety/cameras/corridor'),
      request('/safety/parking/corridor'),
      request('/safety/fuel/corridor'),
    ]);
    return DriverSafetySnapshot(
      restrictions: parse(responses[0], RouteRestrictionNotice.fromJson),
      events: parse(responses[1], LiveRoadEvent.fromJson),
      cameras: parse(responses[2], TrafficCameraLocation.fromJson),
      parking: parse(responses[3], LiveParkingLocation.fromJson),
      fuel: parse(responses[4], LiveDieselStation.fromJson),
      errors: errors,
    );
  }

  Future<List<RoadFeature>> loadRoadFeaturesNearby({
    required LatLng center,
    required double radiusMeters,
    int limit = 300,
  }) async {
    final response = await api.postJson('/safety/road-features/nearby', {
      'lat': center.latitude,
      'lng': center.longitude,
      'radiusMeters': radiusMeters,
      'limit': limit,
    });
    return (response['items'] as List? ?? const [])
        .map((value) => RoadFeature.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> submitRestrictionCorrection({
    required String restrictionId,
    required String correction,
    required LatLng position,
    String? note,
  }) async {
    await api.postJson('/safety/community-reports', {
      'type': 'RESTRICTION_CORRECTION',
      'entityId': restrictionId,
      'value': correction,
      'latitude': position.latitude,
      'longitude': position.longitude,
      if (note != null) 'note': note,
    });
  }

  Future<void> reportParking({
    required String locationId,
    required String availability,
    required LatLng position,
  }) => api.postJson('/safety/community-reports', {
    'type': 'PARKING_AVAILABILITY',
    'entityId': locationId,
    'value': availability,
    'latitude': position.latitude,
    'longitude': position.longitude,
  });

  Future<void> reportDieselPrice({
    required String stationId,
    required double price,
    required LatLng position,
  }) => api.postJson('/safety/community-reports', {
    'type': 'DIESEL_PRICE',
    'entityId': stationId,
    'value': 'DIESEL',
    'numericValue': price,
    'latitude': position.latitude,
    'longitude': position.longitude,
  });
}
