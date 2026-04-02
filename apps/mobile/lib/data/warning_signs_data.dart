import '../models/warning_sign.dart';

/// Pre-seeded list of truck-navigation warning signs for the Semitrack app.
///
/// In production these would be loaded from a backend API or a local database.
/// For development and offline use, this static list provides realistic samples
/// that exercise every [WarningSeverity] level and the most common [WarningType]
/// categories.
///
/// Each entry uses [WarningSign.withSeverityTriggers] so trigger distances are
/// automatically assigned based on severity — the same factory used for
/// dynamically ingested data from the API layer.
///
/// Coordinates are placed along typical US freight corridors (I-10 / I-5 / I-15
/// region) so the popups can be tested by setting a destination in that area.
final List<WarningSign> warningSigns = [
  // ── High severity ──────────────────────────────────────────────────────────

  /// Overpass with insufficient vertical clearance — critical for tall loads.
  WarningSign.withSeverityTriggers(
    id: 'ws_low_bridge_001',
    type: WarningType.lowBridge,
    title: 'Low Bridge Ahead',
    message: 'Clearance 12 ft 6 in — oversized loads must detour.',
    latitude: 34.1201,
    longitude: -118.2512,
    severity: WarningSeverity.high,
    iconName: 'height',
  ),

  /// Road-closed condition blocking through-truck traffic.
  WarningSign.withSeverityTriggers(
    id: 'ws_road_closed_001',
    type: WarningType.roadClosed,
    title: 'Road Closed',
    message: 'All lanes closed — follow detour signs via US-101.',
    latitude: 34.0520,
    longitude: -118.2437,
    severity: WarningSeverity.high,
    iconName: 'block',
  ),

  /// No-truck restriction on a city street not rated for commercial traffic.
  WarningSign.withSeverityTriggers(
    id: 'ws_no_trucks_001',
    type: WarningType.noTrucks,
    title: 'No Trucks Allowed',
    message: 'Commercial vehicles prohibited — local ordinance.',
    latitude: 34.0610,
    longitude: -118.3020,
    severity: WarningSeverity.high,
    iconName: 'do_not_disturb_alt',
  ),

  /// HazMat corridor restriction.
  WarningSign.withSeverityTriggers(
    id: 'ws_hazmat_001',
    type: WarningType.hazmatRestriction,
    title: 'Hazmat Restricted Zone',
    message: 'Hazardous-materials transport prohibited in this corridor.',
    latitude: 33.9425,
    longitude: -118.4081,
    severity: WarningSeverity.high,
    iconName: 'dangerous',
  ),

  // ── Medium severity ────────────────────────────────────────────────────────

  /// Active construction zone — reduced speed limit and lane shifts.
  WarningSign.withSeverityTriggers(
    id: 'ws_construction_001',
    type: WarningType.constructionZone,
    title: 'Construction Zone',
    message: 'Speed limit reduced to 45 mph — expect delays and lane shifts.',
    latitude: 34.2201,
    longitude: -118.1512,
    severity: WarningSeverity.medium,
    iconName: 'construction',
  ),

  /// Sharp curve with a posted advisory speed for trucks.
  WarningSign.withSeverityTriggers(
    id: 'ws_sharp_curve_001',
    type: WarningType.sharpCurve,
    title: 'Sharp Curve Ahead',
    message: 'Advisory speed 30 mph — reduce speed for trucks.',
    latitude: 34.3100,
    longitude: -118.0800,
    severity: WarningSeverity.medium,
    iconName: 'turn_left',
  ),

  /// Steep downgrade requiring brake check before descent.
  WarningSign.withSeverityTriggers(
    id: 'ws_steep_grade_001',
    type: WarningType.steepGrade,
    title: 'Steep Grade — 6%',
    message: 'Test brakes before descent. Runaway ramp 2 miles ahead.',
    latitude: 34.1800,
    longitude: -117.9000,
    severity: WarningSeverity.medium,
    iconName: 'terrain',
  ),

  /// Lane closure — two of three lanes closed for emergency road work.
  WarningSign.withSeverityTriggers(
    id: 'ws_lane_closure_001',
    type: WarningType.laneClosure,
    title: 'Lane Closure',
    message: '2 of 3 lanes closed — merge right.',
    latitude: 34.2700,
    longitude: -118.0200,
    severity: WarningSeverity.medium,
    iconName: 'close',
  ),

  /// Accident ahead — emergency vehicles on road, expect slowdown.
  WarningSign.withSeverityTriggers(
    id: 'ws_accident_001',
    type: WarningType.accidentAhead,
    title: 'Accident Ahead',
    message: 'Emergency vehicles on scene — slow to 35 mph.',
    latitude: 34.1650,
    longitude: -118.1900,
    severity: WarningSeverity.medium,
    iconName: 'warning_amber_rounded',
  ),

  // ── Low severity ───────────────────────────────────────────────────────────

  /// Mandatory weigh station — all trucks must stop unless posted green-light.
  WarningSign.withSeverityTriggers(
    id: 'ws_weigh_station_001',
    type: WarningType.weighStation,
    title: 'Weigh Station Ahead',
    message: 'All commercial vehicles must enter — 1.2 miles ahead.',
    latitude: 34.3800,
    longitude: -118.2100,
    severity: WarningSeverity.low,
    iconName: 'scale',
  ),

  /// Rest area — parking and facilities available for drivers.
  WarningSign.withSeverityTriggers(
    id: 'ws_rest_area_001',
    type: WarningType.restArea,
    title: 'Rest Area',
    message: 'Truck parking, restrooms, and picnic area — 0.8 miles ahead.',
    latitude: 34.4200,
    longitude: -118.2400,
    severity: WarningSeverity.low,
    iconName: 'hotel',
  ),

  /// Animal-crossing zone — deer / elk active at dawn and dusk.
  WarningSign.withSeverityTriggers(
    id: 'ws_animal_crossing_001',
    type: WarningType.animalCrossing,
    title: 'Animal Crossing Zone',
    message: 'High deer activity at dawn and dusk — reduce speed.',
    latitude: 34.4600,
    longitude: -118.3000,
    severity: WarningSeverity.low,
    iconName: 'pets',
  ),

  /// Brake check area before long descent.
  WarningSign.withSeverityTriggers(
    id: 'ws_brake_check_001',
    type: WarningType.brakeCheckArea,
    title: 'Brake Check Area',
    message: 'Inspect brakes before proceeding downhill.',
    latitude: 34.1900,
    longitude: -117.8500,
    severity: WarningSeverity.low,
    iconName: 'stop_circle',
  ),

  /// Detour route for trucks due to low clearance ahead.
  WarningSign.withSeverityTriggers(
    id: 'ws_detour_001',
    type: WarningType.detour,
    title: 'Truck Detour',
    message: 'Follow detour — low bridge ahead on main route.',
    latitude: 34.1100,
    longitude: -118.2600,
    severity: WarningSeverity.low,
    iconName: 'alt_route',
  ),
];
