import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/truck_profile.dart';

void main() {
  test('truck profile API serialization preserves safety fields', () {
    const profile = TruckProfile(
      id: 'truck-1',
      name: 'Long haul',
      isDefault: true,
      heightFt: 13.6,
      widthFt: 8.5,
      lengthFt: 72,
      weightLbs: 80000,
      axleCount: 5,
      hazmatEnabled: true,
      hazardousGoods: ['flammable'],
      trailerType: 'semi',
      trailerCount: 1,
      avoidTolls: true,
      avoidFerries: true,
    );

    final json = profile.toJson();
    expect(json['heightFt'], 13.6);
    expect(json['weightLbs'], 80000);
    expect(json['axleCount'], 5);
    expect(json['hazardousGoods'], ['flammable']);
    expect(json['avoidFerries'], isTrue);

    final decoded = TruckProfile.fromJson({...json, 'id': 'truck-1'});
    expect(decoded.hazmatEnabled, isTrue);
    expect(decoded.trailerType, 'semi');
  });
}
