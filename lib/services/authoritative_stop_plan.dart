class AuthoritativeRouteStop {
  const AuthoritativeRouteStop({
    required this.id,
    required this.latitude,
    required this.longitude,
  });

  final String id;
  final double latitude;
  final double longitude;
}

/// One ordered source of truth for intermediate stops and final destination.
class AuthoritativeStopPlan {
  AuthoritativeStopPlan({required this.destination});

  AuthoritativeRouteStop destination;
  final List<AuthoritativeRouteStop> _intermediateStops = [];

  List<AuthoritativeRouteStop> get intermediateStops =>
      List.unmodifiable(_intermediateStops);

  List<AuthoritativeRouteStop> routeStopsFrom(AuthoritativeRouteStop origin) =>
      [origin, ..._intermediateStops, destination];

  void add(AuthoritativeRouteStop stop) {
    if (stop.id == destination.id) {
      throw ArgumentError(
        'An intermediate stop cannot replace the destination.',
      );
    }
    final existing = _intermediateStops.indexWhere(
      (item) => item.id == stop.id,
    );
    if (existing >= 0) {
      _intermediateStops[existing] = stop;
    } else {
      _intermediateStops.add(stop);
    }
  }

  bool remove(String id) {
    final index = _intermediateStops.indexWhere((item) => item.id == id);
    if (index < 0) return false;
    _intermediateStops.removeAt(index);
    return true;
  }

  void reorder(int oldIndex, int newIndex) {
    if (oldIndex < 0 ||
        oldIndex >= _intermediateStops.length ||
        newIndex < 0 ||
        newIndex >= _intermediateStops.length) {
      throw RangeError('Stop reorder index is outside the route plan.');
    }
    final stop = _intermediateStops.removeAt(oldIndex);
    _intermediateStops.insert(newIndex, stop);
  }

  bool markIntermediateArrived(String id) {
    if (_intermediateStops.isEmpty || _intermediateStops.first.id != id) {
      return false;
    }
    _intermediateStops.removeAt(0);
    return true;
  }
}
