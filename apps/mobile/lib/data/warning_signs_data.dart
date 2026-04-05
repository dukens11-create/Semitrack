import '../models/warning_config.dart';
import '../models/warning_sign.dart';

/// Pre-seeded list of truck-navigation warning signs for the Semitrack app.
///
/// In production these would be loaded from a backend API or a local database.
/// For development and offline use, this static list provides realistic samples
/// that exercise every severity level and the most common warning categories.
///
/// The list is used to seed [WarningManager] on each navigation session start.
/// It is kept separate from the [_sampleWarningSigns] list defined at the
/// bottom of [TruckMapScreen] so the popup-stack system can be independently
/// updated without touching the main map screen.
///
/// Coordinates are placed along typical US freight corridors (I-5 / I-10 /
/// I-15 region in California and Oregon) for realistic testing.
final List<WarningSign> warningSigns = [
  // ── High severity ──────────────────────────────────────────────────────────

  WarningSign(
    id: 'ws_low_bridge_001',
    type: WarningTypes.lowBridge,
    title: 'Low Bridge Ahead',
    lat: 34.1201,
    lng: -118.2512,
    severity: 'high',
    message: 'Clearance 12 ft 6 in — oversized loads must detour.',
    icon: WarningTypes.lowBridge,
  ),
  WarningSign(
    id: 'ws_road_closed_001',
    type: WarningTypes.roadClosed,
    title: 'Road Closed',
    lat: 34.0520,
    lng: -118.2437,
    severity: 'high',
    message: 'All lanes closed — follow detour signs via US-101.',
    icon: WarningTypes.roadClosed,
  ),
  WarningSign(
    id: 'ws_no_trucks_001',
    type: WarningTypes.noTrucksAllowed,
    title: 'No Trucks Allowed',
    lat: 34.0610,
    lng: -118.3020,
    severity: 'high',
    message: 'Commercial vehicles prohibited — local ordinance.',
    icon: WarningTypes.noTrucksAllowed,
  ),
  WarningSign(
    id: 'ws_hazmat_001',
    type: WarningTypes.hazmatRestriction,
    title: 'Hazmat Restricted Zone',
    lat: 33.9425,
    lng: -118.4081,
    severity: 'high',
    message: 'Hazardous-materials transport prohibited in this corridor.',
    icon: WarningTypes.hazmatRestriction,
  ),
  WarningSign(
    id: 'ws_narrow_bridge_001',
    type: WarningTypes.narrowBridge,
    title: 'Narrow Bridge',
    lat: 34.1050,
    lng: -118.2200,
    severity: 'high',
    message: 'One-lane bridge — oversized loads must proceed with caution.',
    icon: WarningTypes.narrowBridge,
  ),
  WarningSign(
    id: 'ws_railroad_crossing_001',
    type: WarningTypes.railroadCrossing,
    title: 'Railroad Crossing',
    lat: 34.2350,
    lng: -118.1350,
    severity: 'high',
    message: 'Active grade crossing — stop if signal is active.',
    icon: WarningTypes.railroadCrossing,
  ),

  // ── Medium severity ────────────────────────────────────────────────────────

  WarningSign(
    id: 'ws_construction_001',
    type: WarningTypes.constructionZone,
    title: 'Construction Zone',
    lat: 34.2201,
    lng: -118.1512,
    severity: 'medium',
    message: 'Speed limit reduced to 45 mph — expect delays and lane shifts.',
    icon: WarningTypes.constructionZone,
  ),
  WarningSign(
    id: 'ws_sharp_curve_001',
    type: WarningTypes.sharpCurve,
    title: 'Sharp Curve Ahead',
    lat: 34.3100,
    lng: -118.0800,
    severity: 'medium',
    message: 'Advisory speed 30 mph — reduce speed for trucks.',
    icon: WarningTypes.sharpCurve,
  ),
  WarningSign(
    id: 'ws_steep_grade_001',
    type: WarningTypes.steepGrade,
    title: 'Steep Grade — 6%',
    lat: 34.1800,
    lng: -117.9000,
    severity: 'medium',
    message: 'Test brakes before descent. Runaway ramp 2 miles ahead.',
    icon: WarningTypes.steepGrade,
  ),
  WarningSign(
    id: 'ws_lane_closure_001',
    type: WarningTypes.laneClosure,
    title: 'Lane Closure',
    lat: 34.2700,
    lng: -118.0200,
    severity: 'medium',
    message: '2 of 3 lanes closed — merge right.',
    icon: WarningTypes.laneClosure,
  ),
  WarningSign(
    id: 'ws_accident_001',
    type: WarningTypes.accidentAhead,
    title: 'Accident Ahead',
    lat: 34.1650,
    lng: -118.1900,
    severity: 'medium',
    message: 'Emergency vehicles on scene — slow to 35 mph.',
    icon: WarningTypes.accidentAhead,
  ),

  // ── Low severity ───────────────────────────────────────────────────────────

  WarningSign(
    id: 'ws_weigh_station_001',
    type: WarningTypes.weighStation,
    title: 'Weigh Station Ahead',
    lat: 34.3800,
    lng: -118.2100,
    severity: 'low',
    message: 'All commercial vehicles must enter — 1.2 miles ahead.',
    icon: WarningTypes.weighStation,
  ),
  WarningSign(
    id: 'ws_rest_area_001',
    type: WarningTypes.restArea,
    title: 'Rest Area',
    lat: 34.4200,
    lng: -118.2400,
    severity: 'low',
    message: 'Truck parking, restrooms, and picnic area — 0.8 miles ahead.',
    icon: WarningTypes.restArea,
  ),
  WarningSign(
    id: 'ws_animal_crossing_001',
    type: WarningTypes.animalCrossing,
    title: 'Animal Crossing Zone',
    lat: 34.4600,
    lng: -118.3000,
    severity: 'low',
    message: 'High deer activity at dawn and dusk — reduce speed.',
    icon: WarningTypes.animalCrossing,
  ),
  WarningSign(
    id: 'ws_brake_check_001',
    type: WarningTypes.brakeCheckArea,
    title: 'Brake Check Area',
    lat: 34.1900,
    lng: -117.8500,
    severity: 'low',
    message: 'Inspect brakes before proceeding downhill.',
    icon: WarningTypes.brakeCheckArea,
  ),
  WarningSign(
    id: 'ws_detour_001',
    type: WarningTypes.detour,
    title: 'Truck Detour',
    lat: 34.1100,
    lng: -118.2600,
    severity: 'low',
    message: 'Follow detour — low bridge ahead on main route.',
    icon: WarningTypes.detour,
  ),
];
