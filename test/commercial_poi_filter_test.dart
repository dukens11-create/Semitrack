import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/services/poi_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('automatic map POIs contain commercial-vehicle services only', () async {
    final pois = await loadAllPois();
    const allowed = <String>{
      'truck_stop',
      'weigh_station',
      'rest_area',
      'brake_check_area',
      'truck_parking',
      'commercial_vehicle_wash',
      'truck_wash',
      'port_of_entry',
    };

    expect(pois, isNotEmpty);
    expect(
      pois.where((poi) => !allowed.contains(poi.category)),
      isEmpty,
      reason: 'Passenger-car and generic businesses must not reach the map.',
    );
    expect(
      pois.where(
        (poi) => const {
          'gas_station',
          'fuel_stop',
          'restaurant',
          'walmart_store',
        }.contains(poi.category),
      ),
      isEmpty,
    );
  });
}
