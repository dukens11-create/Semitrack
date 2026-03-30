import 'package:latlong2/latlong.dart';

/// A single stop on a multi-leg trip (pickup, delivery, or waypoint).
///
/// Each stop has a unique [id], a human-readable [name], and a GPS [position].
/// The optional [type] labels the stop's role in the load (pickup / delivery /
/// waypoint); defaults to [StopType.waypoint] when not explicitly set.
class TripStop {
  TripStop({
    required this.id,
    required this.name,
    required this.position,
    this.type = StopType.waypoint,
  });

  /// Unique identifier (millisecond timestamp string).
  final String id;

  /// Human-readable stop name or address.
  final String name;

  /// GPS position of the stop.
  final LatLng position;

  /// Role of this stop in the dispatch load.
  final StopType type;

  TripStop copyWith({
    String? id,
    String? name,
    LatLng? position,
    StopType? type,
  }) {
    return TripStop(
      id: id ?? this.id,
      name: name ?? this.name,
      position: position ?? this.position,
      type: type ?? this.type,
    );
  }
}

/// Role a stop plays in a multi-stop dispatch load.
enum StopType {
  pickup,
  delivery,
  waypoint;

  String get label {
    switch (this) {
      case StopType.pickup:
        return 'Pickup';
      case StopType.delivery:
        return 'Delivery';
      case StopType.waypoint:
        return 'Waypoint';
    }
  }
}
