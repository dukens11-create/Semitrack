import 'package:flutter/material.dart';

/// Canonical string constants for all supported truck safety warning types.
///
/// Using constants avoids scattered string literals and makes it safe to add
/// new types: add a constant here, update [WarningConfig.styles], add sample
/// data — no other code changes needed.
class WarningTypes {
  WarningTypes._();

  static const String lowBridge = 'low_bridge';
  static const String weightRestriction = 'weight_restriction';
  static const String noTrucksAllowed = 'no_trucks_allowed';
  static const String hazmatRestriction = 'hazmat_restriction';
  static const String steepGrade = 'steep_grade';
  static const String sharpCurve = 'sharp_curve';
  static const String runawayTruckRamp = 'runaway_truck_ramp';
  static const String chainRequirement = 'chain_requirement';
  static const String highWindArea = 'high_wind_area';
  static const String constructionZone = 'construction_zone';
  static const String accidentAhead = 'accident_ahead';
  static const String laneClosure = 'lane_closure';
  static const String roadClosed = 'road_closed';
  static const String detour = 'detour';
  static const String weighStation = 'weigh_station';
  static const String brakeCheckArea = 'brake_check_area';
  static const String restArea = 'rest_area';
  static const String animalCrossing = 'animal_crossing';

  /// Narrow bridge / reduced-width roadway — official USA/Canada warning sign.
  static const String narrowBridge = 'narrow_bridge';

  /// Railroad grade crossing — official USA/Canada warning sign.
  static const String railroadCrossing = 'railroad_crossing';

  /// Types that produce both a visual popup AND a TTS/sound alert.
  ///
  /// All other warning types produce a visual popup only.  Keep this list
  /// limited to hazards that require immediate driver attention.
  static const Set<String> soundAlertTypes = {
    sharpCurve,
    steepGrade,
    lowBridge,
    narrowBridge,
    railroadCrossing,
    animalCrossing,
  };
}

/// Encapsulates the visual style for a single warning type: icon, colour, and
/// short label.  Returned by [WarningConfig.styleFor].
@immutable
class WarningStyle {
  const WarningStyle({
    required this.icon,
    required this.color,
    required this.label,
  });

  /// Material icon used in markers and alert banners.
  final IconData icon;

  /// Default type colour used in contexts where severity is not yet known
  /// (e.g. legend items, static displays).  In live markers and alert banners
  /// this is overridden by [WarningConfig.colorForSeverity] so severity is
  /// always the primary visual signal.
  final Color color;

  /// Short human-readable type label shown next to the icon, e.g. `'Low Bridge'`.
  final String label;
}

/// Single source of truth for mapping every warning type to its visual style.
///
/// **Extending with a new type:**
/// 1. Add a constant to [WarningTypes].
/// 2. Add an entry to [WarningConfig.styles].
/// 3. Add sample / live data.
/// No logic changes are required elsewhere.
class WarningConfig {
  WarningConfig._();

  /// Returns the [WarningStyle] for [type], or a generic fallback style when
  /// the type has not yet been registered in [styles].
  static WarningStyle styleFor(String type) =>
      styles[type] ?? _fallback;

  /// Returns the banner/marker [Color] for [severity].
  ///
  /// - `'high'`   → red
  /// - `'medium'` → orange
  /// - `'low'`    → blue
  static Color colorForSeverity(String severity) {
    switch (severity) {
      case 'high':
        return Colors.red.shade700;
      case 'medium':
        return Colors.orange.shade700;
      case 'low':
      default:
        return Colors.blue.shade700;
    }
  }

  // ── Fallback style used when a type is not in [styles] ───────────────────
  static const WarningStyle _fallback = WarningStyle(
    icon: Icons.warning_amber,
    color: Colors.orange,
    label: 'Warning',
  );

  /// Type-to-style mapping.  Add new entries here when adding new warning types;
  /// no other code changes are needed.
  static const Map<String, WarningStyle> styles = {
    WarningTypes.lowBridge: WarningStyle(
      icon: Icons.height,
      color: Colors.deepOrange,
      label: 'Low Bridge',
    ),
    WarningTypes.weightRestriction: WarningStyle(
      icon: Icons.monitor_weight,
      color: Colors.red,
      label: 'Weight Restriction',
    ),
    WarningTypes.noTrucksAllowed: WarningStyle(
      icon: Icons.no_crash,
      color: Colors.red,
      label: 'No Trucks',
    ),
    WarningTypes.hazmatRestriction: WarningStyle(
      icon: Icons.local_fire_department,
      color: Colors.purple,
      label: 'Hazmat Zone',
    ),
    WarningTypes.steepGrade: WarningStyle(
      icon: Icons.terrain,
      color: Colors.orange,
      label: 'Steep Grade',
    ),
    WarningTypes.sharpCurve: WarningStyle(
      icon: Icons.turn_right,
      color: Colors.orange,
      label: 'Sharp Curve',
    ),
    WarningTypes.runawayTruckRamp: WarningStyle(
      icon: Icons.exit_to_app,
      color: Colors.orange,
      label: 'Runaway Ramp',
    ),
    WarningTypes.chainRequirement: WarningStyle(
      icon: Icons.link,
      color: Colors.blue,
      label: 'Chains Required',
    ),
    WarningTypes.highWindArea: WarningStyle(
      icon: Icons.air,
      color: Colors.orange,
      label: 'High Wind',
    ),
    WarningTypes.constructionZone: WarningStyle(
      icon: Icons.construction,
      color: Colors.orange,
      label: 'Construction',
    ),
    WarningTypes.accidentAhead: WarningStyle(
      icon: Icons.car_crash,
      color: Colors.red,
      label: 'Accident Ahead',
    ),
    WarningTypes.laneClosure: WarningStyle(
      icon: Icons.merge_type,
      color: Colors.orange,
      label: 'Lane Closure',
    ),
    WarningTypes.roadClosed: WarningStyle(
      icon: Icons.block,
      color: Colors.red,
      label: 'Road Closed',
    ),
    WarningTypes.detour: WarningStyle(
      icon: Icons.alt_route,
      color: Colors.blue,
      label: 'Detour',
    ),
    WarningTypes.weighStation: WarningStyle(
      icon: Icons.scale,
      color: Colors.blue,
      label: 'Weigh Station',
    ),
    WarningTypes.brakeCheckArea: WarningStyle(
      icon: Icons.do_not_touch,
      color: Colors.orange,
      label: 'Brake Check',
    ),
    WarningTypes.restArea: WarningStyle(
      icon: Icons.airline_seat_recline_normal,
      color: Colors.blue,
      label: 'Rest Area',
    ),
    WarningTypes.animalCrossing: WarningStyle(
      icon: Icons.pets,
      color: Colors.blue,
      label: 'Animal Crossing',
    ),
    WarningTypes.narrowBridge: WarningStyle(
      icon: Icons.swap_horiz,
      color: Colors.deepOrange,
      label: 'Narrow Bridge',
    ),
    WarningTypes.railroadCrossing: WarningStyle(
      icon: Icons.train,
      color: Colors.red,
      label: 'Railroad Crossing',
    ),
  };
}
