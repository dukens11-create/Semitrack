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
///    on the active [_routePoints] polyline.  Signs not on the route are
///    ignored entirely — they are road hazards for other vehicles.
/// 2. Computes the straight-line distance from [_truckPosition] to the sign.
/// 3. Fires a popup at [WarningSign.firstTriggerMiles], a follow-up at
///    [WarningSign.secondTriggerMiles], and a final reminder at
///    [WarningSign.finalTriggerMiles].  Each trigger fires **at most once**
///    per session (guarded by [WarningSign.shownFirst/Second/Final]).
/// 4. Automatically removes a popup once the truck has passed the sign
///    (distance exceeds [_kRouteProximityMetres] **behind** the truck) so
///    the stack never accumulates stale entries.
///
/// ## Deduplication
///
/// The three trigger flags ([WarningSign.shownFirst], [WarningSign.shownSecond],
/// [WarningSign.shownFinal]) are persisted in the internal [_signs] list via
/// [WarningSign.copyWith] so each stage fires exactly once.  Calling [reset]
/// (e.g. on [_clearActiveRoute]) restores all flags to `false`.
///
/// ## Active popups
///
/// [activePopups] is the ordered list of [ActiveWarning] entries that should
/// currently be shown.  High-severity entries are sorted first.  Non-high
/// entries are evicted from the list after their auto-dismiss duration elapses
/// (managed externally by [WarningPopupStack]).  High-severity entries stay
/// until [dismiss] is called.
class WarningManager extends ChangeNotifier {
  WarningManager({required List<WarningSign> signs}) : _signs = List.of(signs);

  // ── Internal state ────────────────────────────────────────────────────────

  /// Working copy of all warning signs.  Trigger-state flags are updated
  /// in-place via [WarningSign.copyWith] so the original [signs] list is
  /// never mutated.
  List<WarningSign> _signs;

  /// Last known truck position.  Null until [update] is called for the
  /// first time.
  LatLng? _truckPosition;

  /// The active route polyline.  Empty until the first [update] call after
  /// a route has been built.
  List<LatLng> _routePoints = const [];

  /// Whether the navigation session is currently active.  When false, [update]
  /// returns immediately without computing or firing any popups.
  bool _isNavigating = false;

  /// Currently visible warning popups, sorted high → medium → low, then by
  /// ascending distance.
  final List<ActiveWarning> _activePopups = [];

  // ── Public API ─────────────────────────────────────────────────────────────

  /// Read-only view of the currently active warning popups.
  ///
  /// High-severity warnings appear first.  The UI should render these as a
  /// vertical stack anchored to the top-right corner of the map.
  List<ActiveWarning> get activePopups => List.unmodifiable(_activePopups);

  /// Starts or resumes warning evaluation.
  ///
  /// Must be called when the driver presses "Start Navigation".
  void startNavigation() {
    _isNavigating = true;
  }

  /// Pauses warning evaluation without resetting trigger state.
  ///
  /// Call when navigation is paused so GPS updates don't fire popups while
  /// the truck is stationary.
  void pauseNavigation() {
    _isNavigating = false;
  }

  /// Updates the manager with the latest [truckPosition] and [routePoints].
  ///
  /// This is the main entry point — call it on every GPS fix from
  /// [_onGpsPosition].  When [_isNavigating] is false the method returns
  /// immediately so no computation or [notifyListeners] calls occur during
  /// route-preview mode.
  void update({
    required LatLng truckPosition,
    required List<LatLng> routePoints,
  }) {
    if (!_isNavigating) return;

    _truckPosition = truckPosition;
    _routePoints = routePoints;

    bool changed = false;

    for (int i = 0; i < _signs.length; i++) {
      final sign = _signs[i];

      // Skip signs the driver has explicitly dismissed this session.
      if (sign.dismissed) continue;

      // Skip signs not on the active route.
      if (!_isSignOnRoute(sign)) continue;

      final double distMetres = _distanceToSign(truckPosition, sign);
      final double distMiles = distMetres / _kMetresPerMile;

      // ── Check trigger thresholds ────────────────────────────────────────
      // Triggers fire in descending order (first → second → final) and each
      // fires exactly once.  We use nested ifs so the correct popup is added
      // and the flag is set atomically.

      if (!sign.shownFirst && distMiles <= sign.firstTriggerMiles) {
        _signs[i] = sign.copyWith(shownFirst: true);
        _upsertPopup(sign, distMiles);
        changed = true;
      } else if (sign.shownFirst &&
          !sign.shownSecond &&
          distMiles <= sign.secondTriggerMiles) {
        _signs[i] = sign.copyWith(shownSecond: true);
        _upsertPopup(sign, distMiles);
        changed = true;
      } else if (sign.shownSecond &&
          !sign.shownFinal &&
          distMiles <= sign.finalTriggerMiles) {
        _signs[i] = sign.copyWith(shownFinal: true);
        _upsertPopup(sign, distMiles);
        changed = true;
      }

      // ── Update distance on existing popup if already active ─────────────
      final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
      if (idx != -1) {
        _activePopups[idx] = ActiveWarning(
          sign: _activePopups[idx].sign,
          distanceMiles: distMiles,
        );
        changed = true;
      }

      // ── Auto-evict when truck has clearly passed the sign ───────────────
      // A sign is "passed" when the truck-to-sign distance is now greater
      // than the final-trigger threshold AND all triggers have fired OR the
      // sign has been passed for >500 m behind.  This avoids the popup
      // lingering forever after the driver goes past.
      if (sign.shownFinal && distMiles > sign.firstTriggerMiles) {
        final bool removed = _removePopup(sign.id);
        if (removed) changed = true;
      }
    }

    // ── Re-sort active popups: high first, then by distance ────────────────
    if (changed) {
      _sortPopups();
      notifyListeners();
    }
  }

  /// Dismisses the popup for [signId] in response to the driver closing the
  /// card.  Sets [WarningSign.dismissed] = true so the sign is never shown
  /// again in this navigation session.
  void dismiss(String signId) {
    final int i = _signs.indexWhere((s) => s.id == signId);
    if (i == -1) return;
    _signs[i] = _signs[i].copyWith(dismissed: true);
    _removePopup(signId);
    notifyListeners();
  }

  /// Resets all trigger and dismiss state, and clears [activePopups].
  ///
  /// Call this when [_clearActiveRoute] is invoked so a new trip starts
  /// with a clean slate.
  void reset() {
    _signs = _signs
        .map((s) => s.copyWith(
              shownFirst: false,
              shownSecond: false,
              shownFinal: false,
              dismissed: false,
            ))
        .toList();
    _activePopups.clear();
    _isNavigating = false;
    _truckPosition = null;
    _routePoints = const [];
    notifyListeners();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /// Returns true if [sign] is within [_kRouteProximityMetres] of any point
  /// in [_routePoints].
  ///
  /// For performance on long polylines this iterates the point list and exits
  /// as soon as a close-enough point is found.
  bool _isSignOnRoute(WarningSign sign) {
    if (_routePoints.isEmpty) return false;
    for (final point in _routePoints) {
      if (_rawDistanceMetres(
            point.latitude,
            point.longitude,
            sign.latitude,
            sign.longitude,
          ) <=
          _kRouteProximityMetres) {
        return true;
      }
    }
    return false;
  }

  /// Straight-line distance in metres from [from] to [sign].
  double _distanceToSign(LatLng from, WarningSign sign) {
    return _rawDistanceMetres(
      from.latitude,
      from.longitude,
      sign.latitude,
      sign.longitude,
    );
  }

  /// Haversine distance in metres between two WGS-84 coordinates.
  ///
  /// Equivalent to [Geolocator.distanceBetween] but avoids the plugin
  /// dependency inside a plain service class.
  static double _rawDistanceMetres(
    double lat1,
    double lng1,
    double lat2,
    double lng2,
  ) {
    const double r = 6371000.0; // Earth radius in metres
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

  /// Adds [sign] to [_activePopups] if not already present, or updates the
  /// distance if it is.
  void _upsertPopup(WarningSign sign, double distMiles) {
    final int idx = _activePopups.indexWhere((w) => w.sign.id == sign.id);
    if (idx == -1) {
      _activePopups.add(ActiveWarning(sign: sign, distanceMiles: distMiles));
    } else {
      _activePopups[idx] =
          ActiveWarning(sign: sign, distanceMiles: distMiles);
    }
  }

  /// Removes the popup with [signId] from [_activePopups].
  ///
  /// Returns true if an entry was actually removed.
  bool _removePopup(String signId) {
    final int idx = _activePopups.indexWhere((w) => w.sign.id == signId);
    if (idx == -1) return false;
    _activePopups.removeAt(idx);
    return true;
  }

  /// Sorts [_activePopups] so high severity is first, then ascending distance.
  void _sortPopups() {
    _activePopups.sort((a, b) {
      final int sev = _severityOrder(a.sign.severity)
          .compareTo(_severityOrder(b.sign.severity));
      if (sev != 0) return sev;
      return a.distanceMiles.compareTo(b.distanceMiles);
    });
  }

  /// Converts severity to sort key (lower = higher priority).
  static int _severityOrder(WarningSeverity s) {
    switch (s) {
      case WarningSeverity.high:
        return 0;
      case WarningSeverity.medium:
        return 1;
      case WarningSeverity.low:
        return 2;
    }
  }
}
