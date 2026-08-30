import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/core/api_client.dart';
import 'package:semitrack_mobile/models/weigh_station.dart';
import 'package:semitrack_mobile/services/weigh_station_repository.dart';

class WeighStationService {
  WeighStationService(this.api, {WeighStationRepository? repository})
      : repository = repository ?? WeighStationRepository();

  final ApiClient api;
  final WeighStationRepository repository;

  Future<List<UpcomingWeighStation>> getUpcomingWeighStations({
    required List<LatLng> route,
    required double currentRouteOffsetMeters,
    double maxDistanceAheadMeters = 160934,
    double? routeBearing,
  }) async {
    try {
      final response = await api.postJson('/safety/weigh-stations/corridor', {
        'route': route
            .map((point) => {'lat': point.latitude, 'lng': point.longitude})
            .toList(growable: false),
        'currentRouteOffsetMeters': currentRouteOffsetMeters,
        'maxDistanceAheadMeters': maxDistanceAheadMeters,
        'routeBearing': routeBearing,
        'limit': 30,
      });
      return (response['items'] as List? ?? const []).map((value) {
        final json = value as Map<String, dynamic>;
        final currentStatus = json['currentStatus'] as Map<String, dynamic>?;
        final stationJson = <String, dynamic>{
          ...json,
          'status': currentStatus?['value'] ?? json['officialStatus'],
          'statusSource':
              currentStatus?['source'] ?? json['officialStatusSource'],
        };
        return UpcomingWeighStation(
          station: WeighStation.fromJson(stationJson),
          routeDistanceMeters:
              (json['routeDistanceAheadMeters'] as num).toDouble(),
          distanceFromRouteMeters:
              (json['detourOffsetMeters'] as num).toDouble(),
        );
      }).toList(growable: false);
    } catch (_) {
      final bundled = await repository.getAllStations();
      return repository.getStationsAlongRoute(
        bundled,
        route,
        currentRouteOffsetMeters: currentRouteOffsetMeters,
        maxDistanceAheadMeters: maxDistanceAheadMeters,
        routeBearing: routeBearing,
      );
    }
  }

  Future<void> reportStatus({
    required String stationId,
    required WeighStationStatus status,
    required LatLng reporterPosition,
    String? note,
  }) async {
    if (status == WeighStationStatus.unknown) {
      throw ArgumentError('UNKNOWN is not a reportable live status');
    }
    await api.postJson('/safety/community-reports', {
      'type': 'WEIGH_STATION_STATUS',
      'entityId': stationId,
      'value': status.apiValue,
      'latitude': reporterPosition.latitude,
      'longitude': reporterPosition.longitude,
      if (note != null) 'note': note,
    });
  }

  Future<void> vote(String reportId, {required bool confirm}) => api.putJson(
        '/safety/community-reports/$reportId/vote',
        {'value': confirm ? 'CONFIRM' : 'DISAGREE'},
      );

  Future<WeighStationStatusSummary> getStatus(String stationId) async {
    final json = await api.getJson(
      '/safety/community-reports/WEIGH_STATION_STATUS/$stationId/aggregate',
    );
    return WeighStationStatusSummary.fromJson(json);
  }
}
