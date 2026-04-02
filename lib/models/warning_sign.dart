/// Severity levels for truck road-hazard warning signs.
///
/// Used by the [WarningManager] and popup widgets to control card colour,
/// auto-dismiss behaviour, and stacking priority.
enum WarningSeverity {
  /// Critical hazard — red badge, always pinned, never auto-dismissed.
  high,

  /// Moderate concern — orange badge, auto-dismissed after 10 s.
  medium,

  /// Informational — blue badge, auto-dismissed after 6 s.
  low,
}

/// A truck safety warning sign shown on the map and used for route-proximity
/// detection.
///
/// Represents physical or regulatory hazards that a truck driver should be
/// aware of, such as low bridges, weight restrictions, construction zones, or
/// high-wind areas.
///
/// **Severity levels (string field [severity]):**
/// - `'high'`   — immediate danger / legal restriction (banner: red)
/// - `'medium'` — caution required (banner: orange)
/// - `'low'`    — informational (banner: blue/green)
///
/// Use [WarningSign.fromJson] / [toJson] for serialisation.  Equality is
/// value-based on [id] so the same sign is never shown twice in alert sets.
class WarningSign {
  const WarningSign({
    required this.id,
    required this.type,
    required this.title,
    required this.lat,
    required this.lng,
    required this.severity,
    this.message,
    this.icon,
  });

  /// Unique identifier — also used for alert deduplication.
  final String id;

  /// Warning type key, e.g. `'low_bridge'`, `'construction_zone'`.
  /// See [WarningTypes] for the canonical set of type constants.
  final String type;

  /// Human-readable short title shown in markers and the alert banner,
  /// e.g. `'Low Bridge'`.
  final String title;

  /// Latitude of the warning sign location.
  final double lat;

  /// Longitude of the warning sign location.
  final double lng;

  /// Severity level: `'high'`, `'medium'`, or `'low'`.
  final String severity;

  /// Optional detailed message, e.g. `'Clearance 12 ft 6 in'`.
  final String? message;

  /// Optional icon key that maps to a registered image or icon asset,
  /// e.g. `'low_bridge'`.  When null the [WarningConfig.styleFor] mapping
  /// is used as a fallback.
  final String? icon;

  // ── JSON serialisation ────────────────────────────────────────────────────

  /// Creates a [WarningSign] from a JSON map (e.g. from a REST API response).
  factory WarningSign.fromJson(Map<String, dynamic> json) {
    return WarningSign(
      id: json['id'] as String,
      type: json['type'] as String,
      title: json['title'] as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      severity: json['severity'] as String,
      message: json['message'] as String?,
      icon: json['icon'] as String?,
    );
  }

  /// Converts this [WarningSign] to a JSON-serialisable map.
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'title': title,
      'lat': lat,
      'lng': lng,
      'severity': severity,
      if (message != null) 'message': message,
      if (icon != null) 'icon': icon,
    };
  }

  // ── Value equality ────────────────────────────────────────────────────────

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WarningSign &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WarningSign(id: $id, type: $type, severity: $severity, title: $title)';
}
