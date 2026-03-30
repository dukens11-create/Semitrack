import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_settings.dart';

/// Controller that owns the shared [AppSettings] for the Semitrax app.
///
/// Persists settings to [SharedPreferences] so that user preferences survive
/// app restarts. Listeners are notified via [ChangeNotifier] whenever settings
/// change so dependent widgets can rebuild without manual state propagation.
///
/// Usage:
/// ```dart
/// final controller = SettingsController();
/// await controller.load();             // call once at app start
/// await controller.update(newSettings); // persists + notifies listeners
/// ```
class SettingsController extends ChangeNotifier {
  AppSettings _settings = AppSettings.defaults();

  /// The current live settings.  Read-only; mutate via [update].
  AppSettings get settings => _settings;

  // ── SharedPreferences keys ─────────────────────────────────────────────────
  static const _kTruckHeightFt = 'truckHeightFt';
  static const _kTruckWeightLb = 'truckWeightLb';
  static const _kTruckLengthFt = 'truckLengthFt';
  static const _kFuelTankGallons = 'fuelTankGallons';
  static const _kAvgMpg = 'avgMpg';
  static const _kAvoidTolls = 'avoidTolls';
  static const _kAvoidFerries = 'avoidFerries';
  static const _kPreferTruckSafe = 'preferTruckSafe';
  static const _kVoiceNavigation = 'voiceNavigation';
  static const _kDarkMode = 'darkMode';

  /// Loads settings from [SharedPreferences].  Falls back to
  /// [AppSettings.defaults] for any key that has never been saved.
  ///
  /// Call this once during app startup before [runApp].
  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final d = AppSettings.defaults();
    _settings = AppSettings(
      truckHeightFt: prefs.getDouble(_kTruckHeightFt) ?? d.truckHeightFt,
      truckWeightLb: prefs.getDouble(_kTruckWeightLb) ?? d.truckWeightLb,
      truckLengthFt: prefs.getDouble(_kTruckLengthFt) ?? d.truckLengthFt,
      fuelTankGallons:
          prefs.getDouble(_kFuelTankGallons) ?? d.fuelTankGallons,
      avgMpg: prefs.getDouble(_kAvgMpg) ?? d.avgMpg,
      avoidTolls: prefs.getBool(_kAvoidTolls) ?? d.avoidTolls,
      avoidFerries: prefs.getBool(_kAvoidFerries) ?? d.avoidFerries,
      preferTruckSafe:
          prefs.getBool(_kPreferTruckSafe) ?? d.preferTruckSafe,
      voiceNavigation:
          prefs.getBool(_kVoiceNavigation) ?? d.voiceNavigation,
      darkMode: prefs.getBool(_kDarkMode) ?? d.darkMode,
    );
    // No notifyListeners here — called before the widget tree exists.
  }

  /// Replaces the current settings with [newSettings], persists them, and
  /// notifies all registered listeners.
  Future<void> update(AppSettings newSettings) async {
    _settings = newSettings;
    notifyListeners();
    await _persist(newSettings);
  }

  Future<void> _persist(AppSettings s) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kTruckHeightFt, s.truckHeightFt);
    await prefs.setDouble(_kTruckWeightLb, s.truckWeightLb);
    await prefs.setDouble(_kTruckLengthFt, s.truckLengthFt);
    await prefs.setDouble(_kFuelTankGallons, s.fuelTankGallons);
    await prefs.setDouble(_kAvgMpg, s.avgMpg);
    await prefs.setBool(_kAvoidTolls, s.avoidTolls);
    await prefs.setBool(_kAvoidFerries, s.avoidFerries);
    await prefs.setBool(_kPreferTruckSafe, s.preferTruckSafe);
    await prefs.setBool(_kVoiceNavigation, s.voiceNavigation);
    await prefs.setBool(_kDarkMode, s.darkMode);
  }
}
