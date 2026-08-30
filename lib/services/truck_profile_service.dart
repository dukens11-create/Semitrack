import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../models/navigation_state.dart';
import '../models/truck_profile.dart';
import 'native_navigation_service.dart';

class TruckProfileService extends ChangeNotifier {
  TruckProfileService(this.api);
  final ApiClient api;

  List<TruckProfile> profiles = const [];
  TruckProfile? selected;
  bool loading = false;
  String? error;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final response = await api.getJson('/trucks');
      profiles = (response['items'] as List? ?? const [])
          .map((item) => TruckProfile.fromJson(item as Map<String, dynamic>))
          .toList(growable: false);
      selected = profiles.where((profile) => profile.isDefault).firstOrNull ??
          (profiles.isEmpty ? null : profiles.first);
      if (selected != null) await _sendToNative(selected!);
    } catch (exception) {
      error = exception.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> save(TruckProfile profile) async {
    final json = profile.id.isEmpty
        ? await api.postJson('/trucks', profile.toJson())
        : await api.patchJson('/trucks/${profile.id}', profile.toJson());
    final saved = TruckProfile.fromJson(json);
    await load();
    if (saved.isDefault) await select(saved.id);
  }

  Future<void> select(String id) async {
    await api.postJson('/trucks/$id/default', const {});
    await load();
  }

  Future<void> delete(String id) async {
    await api.delete('/trucks/$id');
    await load();
  }

  Future<void> _sendToNative(TruckProfile profile) async {
    try {
      await NativeNavigationService.instance.setTruckProfile(
        NativeTruckProfile(
          heightMeters: profile.heightFt * 0.3048,
          widthMeters: profile.widthFt * 0.3048,
          lengthMeters: profile.lengthFt * 0.3048,
          grossWeightKg: profile.weightLbs * 0.45359237,
          axleCount: profile.axleCount,
          axleWeightsKg: profile.weightPerAxleLbs == null
              ? const []
              : List.filled(
                  profile.axleCount,
                  profile.weightPerAxleLbs! * 0.45359237,
                ),
          hazmatEnabled: profile.hazmatEnabled,
          hazmatClasses: profile.hazardousGoods,
          trailerType: profile.trailerType,
        ),
      );
    } catch (exception) {
      debugPrint('[TruckProfile] Native profile update deferred: $exception');
    }
  }
}
