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
enum _TriggerStage { first, second, final_ }

/// Trigger-distance defaults (in miles) keyed by severity string and stage.
const Map<String, Map<_TriggerStage, double>> _kTriggerDefaults = {
  'high':   { _TriggerStage.first: 2.0, _TriggerStage.second: 1.0, _TriggerStage.final_: 0.5 },
  'medium': { _TriggerStage.first: 1.5, _TriggerStage.second: 0.75, _TriggerStage.final_: 0.3 },
  'low':    { _TriggerStage.first: 1.0, _TriggerStage.second: 0.5,  _TriggerStage.final_: 0.2 },
};

/// Returns the trigger-distance map for [severity], falling back to 'medium'
/// defaults for any unrecognised severity string.
Map<_TriggerStage, double> _triggersFor(String severity) =>
    _kTriggerDefaults[severity] ?? _kTriggerDefaults['medium']!;

/// A single active warning popup entry exposed by [WarningManager.activePopups].
///
/// Bundles the [WarningSign] together with the distance ahead so the UI can
/// render a "X mi ahead" label without recomputing the distance itself.
@immutable
class ActiveWarning {
  const ActiveWarning({required this.sign, required this.distanceMiles});

  /// The warning sign whose popup is currently visible.
  final WarningSign sign;

  /// Straight-line distance from the current truck position to the sign,
  /// in miles.  Updated on every [WarningManager.update] call.
  final double distanceMiles;
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
/// 3. Fires a popup at the first-trigger distance, a follow-up at the
///    second-trigger, and a final reminder at the final-trigger.  Each stage
///    fires **at most once** per session per sign.
/// 4. Automatically removes a popup once the truck has passed the sign
///    (all triggers fired and truck is beyond the first-trigger distance).
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
  final Map<String, Set<_TriggerStage>> _firedStages = {};

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

      final triggers = _triggersFor(sign.severity);
      final fired = _firedStages.putIfAbsent(sign.id, () => {});

      // ── Check each trigger stage in order ──────────────────────────────
      if (!fired.contains(_TriggerStage.first) &&
          distMiles <= triggers[_TriggerStage.first]!) {
        fired.add(_TriggerStage.first);
        _upsertPopup(sign, distMiles);
        changed = true;
      } else if (fired.contains(_TriggerStage.first) &&
          !fired.contains(_TriggerStage.second) &&
          distMiles <= triggers[_TriggerStage.second]!) {
        fired.add(_TriggerStage.second);
        _upsertPopup(sign, distMiles);
        changed = true;
      } else if (fired.contains(_TriggerStage.second) &&
          !fired.contains(_TriggerStage.final_) &&
          distMiles <= triggers[_TriggerStage.final_]!) {
        fired.add(_TriggerStage.final_);
        _upsertPopup(sign, distMiles);
        changed = true;
      }

      // ── Update distance on already-active popup ─────────────────────────
      final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
      if (idx != -1) {
        _activePopups[idx] =
            ActiveWarning(sign: _activePopups[idx].sign, distanceMiles: distMiles);
        changed = true;
      }

      // ── Auto-evict once the truck has passed the sign ───────────────────
      if (fired.containsAll([
            _TriggerStage.first,
            _TriggerStage.second,
            _TriggerStage.final_,
          ]) &&
          distMiles > triggers[_TriggerStage.first]!) {
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

  void _upsertPopup(WarningSign sign, double distMiles) {
    final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
    if (idx == -1) {
      _activePopups.add(ActiveWarning(sign: sign, distanceMiles: distMiles));
    } else {
      _activePopups[idx] =
          ActiveWarning(sign: sign, distanceMiles: distMiles);
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
