import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/core/api_client.dart';
import 'package:semitrack_mobile/models/poi_item.dart';

class HerePlacesService {
  const HerePlacesService(this._api);

  final ApiClient _api;

  Future<List<PoiItem>> searchNearby({
    required String category,
    required LatLng center,
    int radiusMeters = 50000,
    int limit = 50,
  }) async {
    final query = Uri(
      queryParameters: {
        'category': category,
        'lat': center.latitude.toString(),
        'lng': center.longitude.toString(),
        'radiusMeters': radiusMeters.toString(),
        'limit': limit.toString(),
      },
    ).query;
    final response = await _api.getJson('/places/search?$query');
    return _parse(response);
  }

  Future<List<PoiItem>> searchAlongRoute({
    required String category,
    required List<LatLng> route,
    int radiusMeters = 25000,
    int maxResults = 150,
  }) async {
    final response = await _api.postJson('/places/corridor', {
      'category': category,
      'route': route
          .map((point) => {'lat': point.latitude, 'lng': point.longitude})
          .toList(growable: false),
      'radiusMeters': radiusMeters,
      'maxResults': maxResults,
    });
    return _parse(response);
  }

  List<PoiItem> _parse(Map<String, dynamic> response) {
    return (response['items'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final category = item['category']?.toString() ?? 'truck_parking';
          return PoiItem(
            id: item['id']?.toString() ?? '',
            name: item['name']?.toString() ?? 'Unnamed place',
            category: category,
            icon: _iconForCategory(category),
            lat: (item['latitude'] as num).toDouble(),
            lng: (item['longitude'] as num).toDouble(),
            verified: false,
            country: item['country']?.toString() ?? '',
            stateOrProvince: item['state']?.toString() ?? '',
            city: item['city']?.toString() ?? '',
            address: item['address']?.toString() ?? '',
            dataSource: 'HERE',
            providerBacked: true,
          );
        })
        .where((item) => item.id.isNotEmpty)
        .toList(growable: false);
  }

  String _iconForCategory(String category) {
    switch (category) {
      case 'walmart_store':
        return 'walmart_store';
      case 'weigh_station':
        return 'weight_station';
      case 'truck_stop':
        return 'truck_stop_default';
      case 'rest_area':
        return 'rest_area';
      case 'fuel_stop':
        return 'gas_station';
      default:
        return 'truck_parking';
    }
  }
}
