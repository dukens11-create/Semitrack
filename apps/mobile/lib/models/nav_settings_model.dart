// Navigation settings model.
//
// Stores the toggle/selection state for every item on the "More" settings
// page.  All values default to a sensible initial state.  The actual feature
// logic is wired separately; this class is UI-state only.

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
}
