import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

/// Shared app-state controller that bridges the TruckMapScreen (source of
/// truth) and the DriverDashboardScreen (consumer).
///
/// TruckMapScreen calls [updateTripOverview] whenever navigation state
/// changes (route load, GPS tick, arrival, reroute).  DriverDashboardScreen
/// wraps its build in an [AnimatedBuilder] targeting this controller so
/// every notifyListeners() call triggers an instant UI refresh.
class NavigationStateController extends ChangeNotifier {
  // ── Navigation status ─────────────────────────────────────────────────────
  bool navigationActive = false;
  bool arrived = false;

  // ── Trip overview strings ─────────────────────────────────────────────────
  String currentDestinationName = '--';
  String etaText = '--';
  String milesLeftText = '--';

  // ── HOS and fuel ──────────────────────────────────────────────────────────
  String hosText = '--';
  String fuelPercentText = '--';
  String fuelRangeText = '--';

  // ── Positions (optional, for future map integration) ──────────────────────
  LatLng? currentPosition;
  LatLng? destinationPosition;

  // ── Recent trips list ─────────────────────────────────────────────────────
  List<String> recentTrips = const [];

  // ── Mutators ──────────────────────────────────────────────────────────────

  /// Push an updated trip overview snapshot from TruckMapScreen.
  ///
  /// Call this after every GPS tick, route load, arrival, or reroute so that
  /// DriverDashboardScreen always reflects the latest state.
  void updateTripOverview({
    required bool navigationActive,
    required bool arrived,
    required String currentDestinationName,
    required String etaText,
    required String milesLeftText,
    required String hosText,
    required String fuelPercentText,
    required String fuelRangeText,
    LatLng? currentPosition,
    LatLng? destinationPosition,
  }) {
    this.navigationActive = navigationActive;
    this.arrived = arrived;
    this.currentDestinationName = currentDestinationName;
    this.etaText = etaText;
    this.milesLeftText = milesLeftText;
    this.hosText = hosText;
    this.fuelPercentText = fuelPercentText;
    this.fuelRangeText = fuelRangeText;
    this.currentPosition = currentPosition;
    this.destinationPosition = destinationPosition;
    notifyListeners();
  }

  /// Replace the recent trips list and notify listeners.
  void setRecentTrips(List<String> trips) {
    recentTrips = List.unmodifiable(trips);
    notifyListeners();
  }
}
