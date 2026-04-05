import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import '../models/warning_sign.dart';

/// Metres-per-mile constant used for distance unit conversion.
const double _kMetresPerMile = 1609.344;

/// Proximity threshold in metres used to decide whether a [WarningSign] sits
/// "on the route" (within this distance of any route polyline point).
///
/// 300 m provides a comfortable buffer that catches signs just off the
/// drawn polyline without triggering false positives from distant roads.
const double _kRouteProximityMetres = 300.0;

/// Trigger stages for a single warning sign.
///
/// Stages fire in order as the driver approaches the sign:
/// - [preload]     2.0 mi (highway) / 1.0 mi (city): low-emphasis awareness.
/// - [visible]     1.0 mi (highway) / 0.5 mi (city): normal marker appears.
/// - [highlighted] 0.5 mi (highway) / 0.25 mi (city): stronger highlight.
/// - [urgent]      0.2 mi (highway) / 0.1 mi (city): maximum emphasis.
enum WarningTriggerStage {
  /// 2.0 mi (highway) / 1.0 mi (city) — preload awareness, low emphasis.
  preload,

  /// 1.0 mi (highway) / 0.5 mi (city) — visible ahead warning.
  visible,

  /// 0.5 mi (highway) / 0.25 mi (city) — strong pop / highlight.
  highlighted,

  /// 0.2 mi (highway) / 0.1 mi (city) — urgent / maximum emphasis.
  urgent,
}

/// Highway trigger-distance defaults (in miles) keyed by stage.
///
/// Used by both [WarningManager.update] and the map marker emphasis logic in
/// [TruckMapScreen] to compute the correct visual emphasis level for each sign.
const Map<WarningTriggerStage, double> kHighwayWarningTriggers = {
  WarningTriggerStage.preload:     2.0,
  WarningTriggerStage.visible:     1.0,
  WarningTriggerStage.highlighted: 0.5,
  WarningTriggerStage.urgent:      0.2,
};

/// City / low-speed road trigger-distance defaults (in miles) keyed by stage.
/// Shorter than highway so drivers on urban streets still receive timely alerts.
///
/// Used by both [WarningManager.update] and the map marker emphasis logic in
/// [TruckMapScreen] to compute the correct visual emphasis level for each sign.
const Map<WarningTriggerStage, double> kCityWarningTriggers = {
  WarningTriggerStage.preload:     1.0,
  WarningTriggerStage.visible:     0.5,
  WarningTriggerStage.highlighted: 0.25,
  WarningTriggerStage.urgent:      0.1,
};

/// Returns the trigger-distance map for [sign] based on its [WarningSign.roadType].
Map<WarningTriggerStage, double> _triggersFor(WarningSign sign) =>
    sign.roadType == 'city' ? kCityWarningTriggers : kHighwayWarningTriggers;

/// A single active warning popup entry exposed by [WarningManager.activePopups].
///
/// Bundles the [WarningSign] together with the distance ahead and the current
/// trigger stage so the UI can render appropriate emphasis without recomputing
/// distances itself.
@immutable
class ActiveWarning {
  const ActiveWarning({
    required this.sign,
    required this.distanceMiles,
    required this.stage,
  });

  /// The warning sign whose popup is currently visible.
  final WarningSign sign;

  /// Straight-line distance from the current truck position to the sign,
  /// in miles.  Updated on every [WarningManager.update] call.
  final double distanceMiles;

  /// The highest trigger stage that has fired for this sign in the current
  /// session.  Used by the UI to apply the correct emphasis level.
  final WarningTriggerStage stage;
}

/// Manages the lifecycle of truck-navigation warning popups.
///
/// [WarningManager] is a [ChangeNotifier] that should be created once in the
/// navigation screen's state and updated on every GPS position fix via
/// [update].  Callers listen to change notifications to rebuild the
/// [WarningPopupStack] overlay.
///
/// ## Proximity logic
///
/// For each [WarningSign] in [signs], the manager:
/// 1. Checks whether the sign is within [_kRouteProximityMetres] of any point
///    on the active route polyline.  Signs not on the route are ignored.
/// 2. Computes the straight-line distance from the truck position to the sign.
/// 3. Fires a popup at each of the four trigger stages (preload → visible →
///    highlighted → urgent).  Each stage fires **at most once** per session
///    per sign.
/// 4. Automatically removes a popup once the truck has passed the sign
///    (all triggers fired and truck is beyond the preload distance).
///
/// ## Road-type thresholds
///
/// Highway (default) uses full distances: 2.0 / 1.0 / 0.5 / 0.2 miles.
/// City / low-speed roads use shorter distances: 1.0 / 0.5 / 0.25 / 0.1 miles.
///
/// ## Deduplication
///
/// Per-sign trigger state is tracked internally in [_firedStages] so the
/// [WarningSign] model stays immutable.  Calling [reset] restores all state.
///
/// ## Active popups
///
/// [activePopups] is ordered: high severity first, then ascending distance.
/// Non-high entries are evicted automatically; high entries stay until
/// [dismiss] is called.
class WarningManager extends ChangeNotifier {
  WarningManager({required List<WarningSign> signs}) : _signs = List.of(signs);

  // ── Internal state ────────────────────────────────────────────────────────

  final List<WarningSign> _signs;

  /// Tracks which trigger stages have fired for each sign id.
  final Map<String, Set<WarningTriggerStage>> _firedStages = {};

  /// Signs that the driver has explicitly dismissed this session.
  final Set<String> _dismissed = {};

  LatLng? _truckPosition;
  List<LatLng> _routePoints = const [];
  bool _isNavigating = false;

  final List<ActiveWarning> _activePopups = [];

  // ── Public API ─────────────────────────────────────────────────────────────

  /// Read-only view of the currently active warning popups.
  ///
  /// High-severity warnings appear first, then by ascending distance.
  List<ActiveWarning> get activePopups => List.unmodifiable(_activePopups);

  /// Starts warning evaluation.  Must be called when navigation begins.
  void startNavigation() {
    _isNavigating = true;
  }

  /// Pauses warning evaluation without resetting trigger state.
  void pauseNavigation() {
    _isNavigating = false;
  }

  /// Updates proximity state from the latest [truckPosition] and [routePoints].
  ///
  /// Call this on every GPS fix from [_onGpsPosition].  No-ops when
  /// [_isNavigating] is false.
  void update({
    required LatLng truckPosition,
    required List<LatLng> routePoints,
  }) {
    if (!_isNavigating) return;

    _truckPosition = truckPosition;
    _routePoints = routePoints;

    bool changed = false;

    for (final sign in _signs) {
      if (_dismissed.contains(sign.id)) continue;
      if (!_isSignOnRoute(sign)) continue;

      final double distMetres = _distanceToSign(truckPosition, sign);
      final double distMiles = distMetres / _kMetresPerMile;

      final triggers = _triggersFor(sign);
      final fired = _firedStages.putIfAbsent(sign.id, () => {});

      // ── Check trigger stages in order, advancing at most one stage per call ──
      //
      // Using else-if ensures exactly one new stage fires per GPS update so the
      // driver receives distinct popup events as they approach the sign (rather
      // than having all stages collapse into a single call).
      WarningTriggerStage? newStage;

      if (!fired.contains(WarningTriggerStage.preload) &&
          distMiles <= triggers[WarningTriggerStage.preload]!) {
        fired.add(WarningTriggerStage.preload);
        newStage = WarningTriggerStage.preload;
      } else if (fired.contains(WarningTriggerStage.preload) &&
          !fired.contains(WarningTriggerStage.visible) &&
          distMiles <= triggers[WarningTriggerStage.visible]!) {
        fired.add(WarningTriggerStage.visible);
        newStage = WarningTriggerStage.visible;
      } else if (fired.contains(WarningTriggerStage.visible) &&
          !fired.contains(WarningTriggerStage.highlighted) &&
          distMiles <= triggers[WarningTriggerStage.highlighted]!) {
        fired.add(WarningTriggerStage.highlighted);
        newStage = WarningTriggerStage.highlighted;
      } else if (fired.contains(WarningTriggerStage.highlighted) &&
          !fired.contains(WarningTriggerStage.urgent) &&
          distMiles <= triggers[WarningTriggerStage.urgent]!) {
        fired.add(WarningTriggerStage.urgent);
        newStage = WarningTriggerStage.urgent;
      }

      if (newStage != null) {
        _upsertPopup(sign, distMiles, _highestFiredStage(fired));
        changed = true;
      }

      // ── Update distance on already-active popup ─────────────────────────
      final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
      if (idx != -1) {
        _activePopups[idx] = ActiveWarning(
          sign: _activePopups[idx].sign,
          distanceMiles: distMiles,
          stage: _highestFiredStage(fired),
        );
        changed = true;
      }

      // ── Auto-evict once the truck has passed the sign ───────────────────
      if (fired.containsAll(WarningTriggerStage.values) &&
          distMiles > triggers[WarningTriggerStage.preload]!) {
        if (_removePopup(sign.id)) changed = true;
      }
    }

    if (changed) {
      _sortPopups();
      notifyListeners();
    }
  }

  /// Dismisses the popup for [signId] when the driver closes the card.
  ///
  /// The sign is not shown again in this navigation session.
  void dismiss(String signId) {
    _dismissed.add(signId);
    if (_removePopup(signId)) notifyListeners();
  }

  /// Resets all trigger and dismiss state and clears [activePopups].
  ///
  /// Call this when [_clearActiveRoute] is invoked so a new trip starts clean.
  void reset() {
    _firedStages.clear();
    _dismissed.clear();
    _activePopups.clear();
    _isNavigating = false;
    _truckPosition = null;
    _routePoints = const [];
    notifyListeners();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  bool _isSignOnRoute(WarningSign sign) {
    if (_routePoints.isEmpty) return false;
    for (final point in _routePoints) {
      if (_rawDistanceMetres(
            point.latitude, point.longitude, sign.lat, sign.lng,
          ) <=
          _kRouteProximityMetres) {
        return true;
      }
    }
    return false;
  }

  double _distanceToSign(LatLng from, WarningSign sign) =>
      _rawDistanceMetres(from.latitude, from.longitude, sign.lat, sign.lng);

  /// Haversine distance in metres between two WGS-84 coordinates.
  static double _rawDistanceMetres(
    double lat1, double lng1, double lat2, double lng2,
  ) {
    const double r = 6371000.0;
    final double dLat = _toRad(lat2 - lat1);
    final double dLng = _toRad(lng2 - lng1);
    final double a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_toRad(lat1)) *
            math.cos(_toRad(lat2)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  static double _toRad(double deg) => deg * math.pi / 180.0;

  /// Returns the highest [WarningTriggerStage] present in [fired].
  static WarningTriggerStage _highestFiredStage(
    Set<WarningTriggerStage> fired,
  ) {
    for (final stage in WarningTriggerStage.values.reversed) {
      if (fired.contains(stage)) return stage;
    }
    return WarningTriggerStage.preload;
  }

  void _upsertPopup(
    WarningSign sign,
    double distMiles,
    WarningTriggerStage stage,
  ) {
    final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
    final entry = ActiveWarning(
      sign: sign,
      distanceMiles: distMiles,
      stage: stage,
    );
    if (idx == -1) {
      _activePopups.add(entry);
    } else {
      _activePopups[idx] = entry;
    }
  }

  bool _removePopup(String signId) {
    final int idx = _activePopups.indexWhere((w) => w.sign.id == signId);
    if (idx == -1) return false;
    _activePopups.removeAt(idx);
    return true;
  }

  void _sortPopups() {
    _activePopups.sort((a, b) {
      final int sev = _severityOrder(a.sign.severity)
          .compareTo(_severityOrder(b.sign.severity));
      if (sev != 0) return sev;
      return a.distanceMiles.compareTo(b.distanceMiles);
    });
  }

  static int _severityOrder(String s) {
    switch (s) {
      case 'high':
        return 0;
      case 'medium':
        return 1;
      default:
        return 2;
    }
  }
}
