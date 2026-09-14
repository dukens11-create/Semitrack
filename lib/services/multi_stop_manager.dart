class NavigationStop<T> {
  const NavigationStop({required this.id, required this.value, this.completed = false});
  final String id;
  final T value;
  final bool completed;
  NavigationStop<T> copyWith({bool? completed}) => NavigationStop(id: id, value: value, completed: completed ?? this.completed);
}

/// Deterministic stop state. Route recalculation remains the caller's job and
/// must pass the normal truckSafe/navigationAllowed gate.
class MultiStopManager<T> {
  MultiStopManager([Iterable<NavigationStop<T>> initial = const []]) : _stops = List.of(initial);
  final List<NavigationStop<T>> _stops;
  List<NavigationStop<T>> get stops => List.unmodifiable(_stops);
  NavigationStop<T>? get nextStop {
    for (final stop in _stops) {
      if (!stop.completed) return stop;
    }
    return null;
  }
  void add(NavigationStop<T> stop) {
    if (_stops.any((s) => s.id == stop.id)) throw ArgumentError('Duplicate stop id');
    _stops.add(stop);
  }
  bool remove(String id) {
    final index = _stops.indexWhere((s) => s.id == id);
    if (index < 0) return false;
    _stops.removeAt(index);
    return true;
  }
  void reorder(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= _stops.length || newIndex < 0 || newIndex >= _stops.length) throw RangeError('Invalid stop index');
    final item = _stops.removeAt(oldIndex);
    _stops.insert(newIndex, item);
  }
  bool skip(String id) => complete(id);
  bool complete(String id) {
    final index = _stops.indexWhere((s) => s.id == id);
    if (index < 0) return false;
    _stops[index] = _stops[index].copyWith(completed: true);
    return true;
  }
}
