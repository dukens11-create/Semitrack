import 'package:latlong2/latlong.dart';

/// Categories of truck restrictions placed on roads.
enum RestrictionType {
  /// Bridge or underpass with insufficient vertical clearance for the truck.
  lowBridge,

  /// Road with a posted maximum weight limit the truck may exceed.
  weightLimit,

  /// Road with a posted maximum vehicle length the truck may exceed.
  lengthLimit,

  /// Road where commercial trucks (or CMVs) are prohibited entirely.
  noTruckRoad,

  /// Corridor or zone that prohibits hazardous-materials transport.
  hazmatRestriction,
}

/// A single point-based truck restriction on the road network.
///
/// Each restriction represents a physical or regulatory constraint at a
/// geographic location (e.g. a low bridge, weight-limited road, or hazmat
/// zone).  The [limitValue] and [limitUnit] fields store the applicable
/// numerical threshold for display and violation comparison.
class TruckRestriction {
  const TruckRestriction({
    required this.id,
    required this.position,
    required this.type,
    required this.name,
    required this.description,
    this.limitValue,
    this.limitUnit,
  });

  /// Unique identifier — also used as the alert-deduplication key.
  final String id;

  /// Geographic location of the restriction point.
  final LatLng position;

  /// Category of this restriction.
  final RestrictionType type;

  /// Short human-readable name, e.g. "Morrison Bridge – Portland".
  final String name;

  /// Detailed description shown in the violation warning sheet.
  final String description;

  /// Numeric threshold applicable to this restriction (e.g. 12.6 ft for
  /// a low-bridge clearance, or 40.0 tons for a weight limit).
  /// Null for categorical restrictions such as [RestrictionType.noTruckRoad].
  final double? limitValue;

  /// Unit label for [limitValue], e.g. "ft" or "tons".  Null when
  /// [limitValue] is null.
  final String? limitUnit;
}
