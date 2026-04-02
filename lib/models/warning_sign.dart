/// Severity levels for truck road-hazard warning signs.
///
/// Used to control popup colour, auto-dismiss behaviour, and stacking priority.
enum WarningSeverity {
  /// Critical hazard — red badge, always pinned, never auto-dismissed.
  high,

  /// Moderate concern — orange badge, auto-dismissed after 10 s.
  medium,

  /// Informational — blue badge, auto-dismissed after 6 s.
  low,
}

/// All supported warning-sign categories for the Semitrack warning system.
///
/// Add new variants here to extend the system; [WarningManager] and UI
/// helpers resolve icons / labels from this enum so no other change is needed.
enum WarningType {
  lowBridge,
  weightRestriction,
  noTrucks,
  hazmatRestriction,
  steepGrade,
  sharpCurve,
  runawayTruckRamp,
  chainRequirement,
  highWindArea,
  constructionZone,
  accidentAhead,
  laneClosure,
  roadClosed,
  detour,
  weighStation,
  brakeCheckArea,
  restArea,
  animalCrossing,
  portOfEntry,
  icyRoad,
  floodingRoad,
}

/// A single truck-navigation warning sign with proximity-trigger thresholds.
///
/// Each [WarningSign] is displayed as a popup card ([WarningPopupCard]) when
/// the truck approaches within [firstTriggerMiles] of the sign's location
/// during an active navigation session.  Once the truck passes through
/// [secondTriggerMiles] and [finalTriggerMiles], additional reminders may
/// fire; each trigger fires at most once per navigation session per sign.
///
/// The [dismissed] flag is set when the driver explicitly closes the card,
/// preventing re-display regardless of remaining distance thresholds.
class WarningSign {
  const WarningSign({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    required this.latitude,
    required this.longitude,
    required this.severity,
    required this.iconName,
    required this.firstTriggerMiles,
    required this.secondTriggerMiles,
    required this.finalTriggerMiles,
    this.shownFirst = false,
    this.shownSecond = false,
    this.shownFinal = false,
    this.dismissed = false,
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  /// Unique identifier — used as the deduplication key in [WarningManager].
  final String id;

  // ── Classification ────────────────────────────────────────────────────────

  /// Category of this warning, e.g. [WarningType.lowBridge].
  final WarningType type;

  /// Short human-readable name shown as the card headline.
  final String title;

  /// Detail message shown beneath the title, e.g. "Clearance 12 ft 6 in".
  final String message;

  // ── Location ──────────────────────────────────────────────────────────────

  /// WGS-84 latitude of the warning sign.
  final double latitude;

  /// WGS-84 longitude of the warning sign.
  final double longitude;

  // ── Display ───────────────────────────────────────────────────────────────

  /// Severity level — controls card colour and auto-dismiss behaviour.
  final WarningSeverity severity;

  /// Icon-name token used by [warningIconData] to resolve a Material icon.
  final String iconName;

  // ── Trigger distances (miles ahead of sign location) ──────────────────────

  /// Distance in miles at which the first warning popup is shown.
  final double firstTriggerMiles;

  /// Distance in miles at which a second (closer) reminder is shown.
  final double secondTriggerMiles;

  /// Distance in miles at which the final "imminent" reminder is shown.
  final double finalTriggerMiles;

  // ── Trigger state (mutable via copyWith) ──────────────────────────────────

  /// True once the first-trigger popup has been displayed this session.
  final bool shownFirst;

  /// True once the second-trigger popup has been displayed this session.
  final bool shownSecond;

  /// True once the final-trigger popup has been displayed this session.
  final bool shownFinal;

  /// True when the driver has explicitly dismissed this warning card.
  /// Once dismissed, this sign is not shown again in the same session.
  final bool dismissed;

  // ── Factory ───────────────────────────────────────────────────────────────

  /// Creates a [WarningSign] with trigger-mile defaults based on [severity].
  ///
  /// | severity | first  | second | final  |
  /// |----------|--------|--------|--------|
  /// | high     | 2.0 mi | 1.0 mi | 0.5 mi |
  /// | medium   | 1.5 mi | 0.75mi | 0.3 mi |
  /// | low      | 1.0 mi | 0.5 mi | 0.2 mi |
  factory WarningSign.withSeverityTriggers({
    required String id,
    required WarningType type,
    required String title,
    required String message,
    required double latitude,
    required double longitude,
    required WarningSeverity severity,
    required String iconName,
  }) {
    final double first;
    final double second;
    final double final_;
    switch (severity) {
      case WarningSeverity.high:
        first = 2.0;
        second = 1.0;
        final_ = 0.5;
        break;
      case WarningSeverity.medium:
        first = 1.5;
        second = 0.75;
        final_ = 0.3;
        break;
      case WarningSeverity.low:
        first = 1.0;
        second = 0.5;
        final_ = 0.2;
        break;
    }
    return WarningSign(
      id: id,
      type: type,
      title: title,
      message: message,
      latitude: latitude,
      longitude: longitude,
      severity: severity,
      iconName: iconName,
      firstTriggerMiles: first,
      secondTriggerMiles: second,
      finalTriggerMiles: final_,
    );
  }

  // ── copyWith ──────────────────────────────────────────────────────────────

  /// Returns a new [WarningSign] with the specified fields replaced.
  WarningSign copyWith({
    String? id,
    WarningType? type,
    String? title,
    String? message,
    double? latitude,
    double? longitude,
    WarningSeverity? severity,
    String? iconName,
    double? firstTriggerMiles,
    double? secondTriggerMiles,
    double? finalTriggerMiles,
    bool? shownFirst,
    bool? shownSecond,
    bool? shownFinal,
    bool? dismissed,
  }) {
    return WarningSign(
      id: id ?? this.id,
      type: type ?? this.type,
      title: title ?? this.title,
      message: message ?? this.message,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      severity: severity ?? this.severity,
      iconName: iconName ?? this.iconName,
      firstTriggerMiles: firstTriggerMiles ?? this.firstTriggerMiles,
      secondTriggerMiles: secondTriggerMiles ?? this.secondTriggerMiles,
      finalTriggerMiles: finalTriggerMiles ?? this.finalTriggerMiles,
      shownFirst: shownFirst ?? this.shownFirst,
      shownSecond: shownSecond ?? this.shownSecond,
      shownFinal: shownFinal ?? this.shownFinal,
      dismissed: dismissed ?? this.dismissed,
    );
  }

  // ── JSON serialisation ────────────────────────────────────────────────────

  /// Creates a [WarningSign] from a JSON map, e.g. from a backend response.
  factory WarningSign.fromJson(Map<String, dynamic> json) {
    return WarningSign(
      id: json['id'] as String,
      type: WarningType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => WarningType.constructionZone,
      ),
      title: json['title'] as String,
      message: json['message'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      severity: WarningSeverity.values.firstWhere(
        (e) => e.name == json['severity'],
        orElse: () => WarningSeverity.medium,
      ),
      iconName: json['iconName'] as String,
      firstTriggerMiles: (json['firstTriggerMiles'] as num).toDouble(),
      secondTriggerMiles: (json['secondTriggerMiles'] as num).toDouble(),
      finalTriggerMiles: (json['finalTriggerMiles'] as num).toDouble(),
    );
  }

  /// Serialises this [WarningSign] to a JSON map.
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type.name,
      'title': title,
      'message': message,
      'latitude': latitude,
      'longitude': longitude,
      'severity': severity.name,
      'iconName': iconName,
      'firstTriggerMiles': firstTriggerMiles,
      'secondTriggerMiles': secondTriggerMiles,
      'finalTriggerMiles': finalTriggerMiles,
    };
  }

  // ── Equality ──────────────────────────────────────────────────────────────

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is WarningSign &&
        other.id == id &&
        other.type == type &&
        other.title == title &&
        other.message == message &&
        other.latitude == latitude &&
        other.longitude == longitude &&
        other.severity == severity &&
        other.iconName == iconName &&
        other.firstTriggerMiles == firstTriggerMiles &&
        other.secondTriggerMiles == secondTriggerMiles &&
        other.finalTriggerMiles == finalTriggerMiles &&
        other.shownFirst == shownFirst &&
        other.shownSecond == shownSecond &&
        other.shownFinal == shownFinal &&
        other.dismissed == dismissed;
  }

  @override
  int get hashCode => Object.hash(
        id,
        type,
        title,
        message,
        latitude,
        longitude,
        severity,
        iconName,
        firstTriggerMiles,
        secondTriggerMiles,
        finalTriggerMiles,
        shownFirst,
        shownSecond,
        shownFinal,
        dismissed,
      );
}
