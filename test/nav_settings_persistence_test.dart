import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/nav_settings_model.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('GPS voice settings persist across app restarts', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final saved = NavSettingsModel()
      ..audioMode = 0
      ..voicePackage = 'UK English'
      ..audioPitch = 1.25
      ..audioSpeechRate = 0.65
      ..distanceUnit = DistanceUnit.kilometers;

    await saved.saveToPrefs();

    final restored = NavSettingsModel();
    await restored.loadFromPrefs();

    expect(restored.audioMode, 0);
    expect(restored.voicePackage, 'UK English');
    expect(restored.audioPitch, 1.25);
    expect(restored.audioSpeechRate, 0.65);
    expect(restored.distanceUnit, DistanceUnit.kilometers);
    expect(restored.usesMetric, isTrue);
  });

  test(
    'distance units default safely to miles for existing installs',
    () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final restored = NavSettingsModel();
      await restored.loadFromPrefs();
      expect(restored.distanceUnit, DistanceUnit.miles);
    },
  );
}
