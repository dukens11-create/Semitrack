// Navigation settings model.
//
// Stores the toggle/selection state for every item on the "More" settings
// page.  All values default to a sensible initial state.  The actual feature
// logic is wired separately; this class is UI-state only.
//
// Call [saveToPrefs] to persist all settings and [loadFromPrefs] to restore
// them on startup.  Both methods require the `shared_preferences` package.

import 'package:shared_preferences/shared_preferences.dart';

class NavSettingsModel {
  // ── Shortcut toggles ────────────────────────────────────────────────────
  bool shortcutReroute = true;
  bool shortcutPoiAhead = true;
  bool shortcutSearchPlaces = true;
  bool shortcutReport = true;
  bool shortcutPlacesFilter = false;
  bool shortcutShareTrip = false;

  // ── Nav Truck Avatar ────────────────────────────────────────────────────
  bool customTruckAvatar = false;

  // ── Audio settings ──────────────────────────────────────────────────────
  /// 0 = Muted, 1 = Alert Only, 2 = Unmuted
  int audioMode = 2;
  String voicePackage = 'Default';

  /// TTS pitch (0.5 – 2.0).  Default 1.0.
  double audioPitch = 1.0;

  /// TTS speech rate (0.25 – 1.0).  Default 0.5.
  double audioSpeechRate = 0.5;

  // ── Map type ─────────────────────────────────────────────────────────────
  /// 0 = Map, 1 = Satellite
  int mapType = 0;

  // ── View On Map toggles ──────────────────────────────────────────────────
  bool viewJunctionView = true;
  bool viewLaneAssist = true;
  bool viewTruckRestrictions = true;
  bool viewExit = true;
  bool viewTrafficCongestion = true;
  bool viewTrafficIncidents = true;
  bool viewWeatherAlert = true;
  bool viewPoiAhead = true;
  bool viewWeighStation = true;
  bool viewSpeedLimit = true;
  bool view511Camera = false;
  bool viewRoadSign = true;
  bool viewTollbooth = true;

  // ── Places Filter (POI category toggles) ────────────────────────────────
  // Controls which POI categories are rendered on the map in both browse and
  // navigation modes.  Toggling a category off removes its markers instantly;
  // toggling it on restores them without an app restart.
  bool showTruckStops = true;
  bool showWeighStations = true;
  bool showRestAreas = true;
  bool showBrakeCheckAreas = true;
  bool showTruckParking = true;
  bool showTruckWash = false;
  bool showWeatherAlerts = true;
  bool showWarningSigns = true;
  bool showTollbooths = true;
  bool show511Cameras = false;

  // ── Persistence ──────────────────────────────────────────────────────────

  static const String _kPrefix = 'nav_settings_';

  /// Persist all settings to [SharedPreferences].
  Future<void> saveToPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    // Places Filter
    await prefs.setBool('${_kPrefix}showTruckStops', showTruckStops);
    await prefs.setBool('${_kPrefix}showWeighStations', showWeighStations);
    await prefs.setBool('${_kPrefix}showRestAreas', showRestAreas);
    await prefs.setBool('${_kPrefix}showBrakeCheckAreas', showBrakeCheckAreas);
    await prefs.setBool('${_kPrefix}showTruckParking', showTruckParking);
    await prefs.setBool('${_kPrefix}showTruckWash', showTruckWash);
    await prefs.setBool('${_kPrefix}showWeatherAlerts', showWeatherAlerts);
    await prefs.setBool('${_kPrefix}showWarningSigns', showWarningSigns);
    await prefs.setBool('${_kPrefix}showTollbooths', showTollbooths);
    await prefs.setBool('${_kPrefix}show511Cameras', show511Cameras);
  }

  /// Restore persisted settings from [SharedPreferences].
  /// Fields that have never been saved retain their default values.
  Future<void> loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    // Places Filter — use literal defaults as fallbacks so repeated calls
    // always fall back to the intended initial value, not any prior state.
    showTruckStops =
        prefs.getBool('${_kPrefix}showTruckStops') ?? true;
    showWeighStations =
        prefs.getBool('${_kPrefix}showWeighStations') ?? true;
    showRestAreas =
        prefs.getBool('${_kPrefix}showRestAreas') ?? true;
    showBrakeCheckAreas =
        prefs.getBool('${_kPrefix}showBrakeCheckAreas') ?? true;
    showTruckParking =
        prefs.getBool('${_kPrefix}showTruckParking') ?? true;
    showTruckWash =
        prefs.getBool('${_kPrefix}showTruckWash') ?? false;
    showWeatherAlerts =
        prefs.getBool('${_kPrefix}showWeatherAlerts') ?? true;
    showWarningSigns =
        prefs.getBool('${_kPrefix}showWarningSigns') ?? true;
    showTollbooths =
        prefs.getBool('${_kPrefix}showTollbooths') ?? true;
    show511Cameras =
        prefs.getBool('${_kPrefix}show511Cameras') ?? false;
  }
}
