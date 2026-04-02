// lib/widgets/road_guidance_banner.dart
//
// Full-featured road and highway guidance system for truck navigation.
//
// Provides:
//   • Data models  – RouteType, RoadInfo, ManeuverInfo
//   • Helper fns   – label formatting, chip styling, distance formatting,
//                    road-name shortening
//   • UI widgets   – CurrentRoadChip, NextRoadChip, ExitChip,
//                    LaneGuidanceRow, ThenRoadPreview, RoadGuidanceBanner
//
// Usage
// -----
// Drop [RoadGuidanceBanner] into a [Stack] above your map widget:
//
//   Stack(
//     children: [
//       MapWidget(...),          // map at the bottom of the stack
//       Positioned(
//         top: 0, left: 0, right: 0,
//         child: RoadGuidanceBanner(maneuver: sampleManeuver),
//       ),
//     ],
//   )
//
// For a live integration feed [ManeuverInfo] from your routing engine and
// call [setState] whenever the current step changes.

import 'package:flutter/material.dart';

// ──────────────────────────────────────────────────────────────────────────────
// Data models
// ──────────────────────────────────────────────────────────────────────────────

/// Classification of a road or highway segment.
///
/// Drives the colour and label style shown in [CurrentRoadChip] and
/// [NextRoadChip].  Add new values here and extend [roadChipColor] as the
/// routing data source grows.
enum RouteType {
  /// US Interstate highway (e.g. I-10, I-75).
  interstate,

  /// US Highway, federal designation (e.g. US-19).
  usHighway,

  /// State-numbered route (e.g. FL-826).
  stateRoute,

  /// City street or county road not covered by the above.
  localRoad,
}

/// Describes a single road segment in a turn-by-turn step.
///
/// [routeNumber] is the shield number (e.g. "10", "75", "826").
/// [routeName]   is the human-readable label (e.g. "Interstate 10", "I-75").
/// [direction]   is the cardinal compass direction ("N", "S", "E", "W") when
///               known, or an empty string when the data source omits it.
class RoadInfo {
  const RoadInfo({
    required this.routeNumber,
    required this.routeName,
    required this.routeType,
    this.direction = '',
  });

  /// Shield number shown inside the road chip, e.g. "10" for I-10.
  final String routeNumber;

  /// Full human-readable name, e.g. "Interstate 10 West".
  final String routeName;

  /// Functional classification that controls chip colour and prefix label.
  final RouteType routeType;

  /// Optional compass direction suffix: "N", "S", "E", "W", or empty.
  final String direction;
}

/// All information required to render one turn-by-turn step with full road
/// context, exit guidance, and lane hints — matching a professional GPS display.
///
/// [currentRoad] is the road the driver is currently on.
/// [nextRoad]    is the road the driver should merge / turn onto.
/// [thenRoad]    is the road after [nextRoad], used for the "then …" preview.
/// [exitNumber]  is the exit label (e.g. "352B") or null when not applicable.
/// [laneHint]    is a short directive like "Use right 2 lanes" or null.
class ManeuverInfo {
  const ManeuverInfo({
    required this.instruction,
    required this.maneuverType,
    required this.distanceMeters,
    required this.currentRoad,
    required this.nextRoad,
    this.thenRoad,
    this.exitNumber,
    this.laneHint,
  });

  /// Driver-facing instruction, e.g. "Keep right to merge onto I-75 N".
  final String instruction;

  /// Mapbox / OSRM maneuver modifier: 'merge', 'right', 'left', 'straight',
  /// 'sharp right', 'sharp left', 'uturn', 'roundabout', 'arrive', 'depart'.
  final String maneuverType;

  /// Distance in metres from current position to the maneuver point.
  final double distanceMeters;

  /// Road the driver is currently travelling on.
  final RoadInfo currentRoad;

  /// Road the driver should transition onto at the maneuver point.
  final RoadInfo nextRoad;

  /// Road following [nextRoad]; rendered as a dimmed "then …" preview.
  final RoadInfo? thenRoad;

  /// Exit number label printed in the green exit chip, e.g. "352B".
  final String? exitNumber;

  /// Short lane-use directive, e.g. "Use right 2 lanes".  Displayed in the
  /// [LaneGuidanceRow] below the instruction text.
  final String? laneHint;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sample / demo data
// ──────────────────────────────────────────────────────────────────────────────

/// Pre-built [ManeuverInfo] representing a common highway merge scenario.
///
/// The driver is on I-10 West and must keep right to take exit 352B onto
/// I-75 North toward Atlanta, before continuing onto I-285 East.
///
/// Wire this into any widget in development to see a fully-populated banner:
///
///   RoadGuidanceBanner(maneuver: sampleManeuver)
const ManeuverInfo sampleManeuver = ManeuverInfo(
  instruction: 'Keep right to merge onto I-75 N toward Atlanta',
  maneuverType: 'merge',
  distanceMeters: 610,
  exitNumber: '352B',
  laneHint: 'Use right 2 lanes',
  currentRoad: RoadInfo(
    routeNumber: '10',
    routeName: 'Interstate 10',
    routeType: RouteType.interstate,
    direction: 'W',
  ),
  nextRoad: RoadInfo(
    routeNumber: '75',
    routeName: 'Interstate 75',
    routeType: RouteType.interstate,
    direction: 'N',
  ),
  thenRoad: RoadInfo(
    routeNumber: '285',
    routeName: 'Interstate 285',
    routeType: RouteType.interstate,
    direction: 'E',
  ),
);

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────────────────

/// Returns the short prefix label for a road shield chip ("I-", "US ", "SR ").
///
/// Used by [CurrentRoadChip] and [NextRoadChip] when constructing the
/// compact label shown on each coloured chip.
String roadShieldPrefix(RouteType type) {
  switch (type) {
    case RouteType.interstate:
      return 'I-';
    case RouteType.usHighway:
      return 'US ';
    case RouteType.stateRoute:
      return 'SR ';
    case RouteType.localRoad:
      return '';
  }
}

/// Returns the background colour for a road chip based on its [RouteType].
///
/// Colours follow the US convention used on highway signage:
///   • Interstate  → deep blue  (MUTCD blue)
///   • US Highway  → dark green (MUTCD green)
///   • State Route → teal / dark-green variant
///   • Local Road  → dark grey  (neutral / unclassified)
Color roadChipColor(RouteType type) {
  switch (type) {
    case RouteType.interstate:
      return const Color(0xFF0D47A1); // Material Blue 900
    case RouteType.usHighway:
      return const Color(0xFF1B5E20); // Material Green 900
    case RouteType.stateRoute:
      return const Color(0xFF004D40); // Material Teal 900
    case RouteType.localRoad:
      return const Color(0xFF37474F); // Material Blue-Grey 800
  }
}

/// Formats [meters] as a human-readable distance string for the banner.
///
/// Priority logic matches professional GPS apps:
///   < 30 m    → "Now"          (act immediately)
///   < 200 m   → exact metres   ("85 m")
///   < 1000 m  → rounded 10 m   ("400 m")
///   ≥ 1000 m  → kilometres     ("9.5 km")
String formatGuidanceDistance(double meters) {
  if (meters < 30) return 'Now';
  if (meters < 200) return '${meters.toInt()} m';
  if (meters < 1000) return '${(meters / 10).round() * 10} m';
  return '${(meters / 1000).toStringAsFixed(1)} km';
}

/// Builds the short chip label for [road], e.g. "I-10 W" or "US 19 S".
///
/// Combines [roadShieldPrefix] with the route number and, when non-empty, the
/// direction suffix.  The result is intentionally compact so it fits inside a
/// small rounded chip without truncation.
String roadChipLabel(RoadInfo road) {
  final prefix = roadShieldPrefix(road.routeType);
  final dir = road.direction.isNotEmpty ? ' ${road.direction}' : '';
  return '$prefix${road.routeNumber}$dir';
}

/// Returns a shortened display name for [road] suitable for secondary text.
///
/// Strips the redundant "Interstate N" prefix when a compact chip already
/// shows the shield number, falling back to [routeName] for local roads.
///
/// Examples:
///   "Interstate 10 West" → "I-10 W"
///   "Interstate 75 North" → "I-75 N"
///   "US Highway 19 South" → "US 19 S"
///   "Main Street" → "Main Street"
String shortenRoadName(RoadInfo road) {
  if (road.routeType == RouteType.localRoad) return road.routeName;
  return roadChipLabel(road);
}

/// Returns the [IconData] that matches a Mapbox / OSRM maneuver [modifier].
///
/// Covers the full set of modifier strings emitted by the Mapbox Directions
/// API.  Unknown values fall back to [Icons.navigation].
IconData maneuverIconData(String modifier) {
  switch (modifier.toLowerCase()) {
    case 'left':
    case 'slight left':
      return Icons.turn_left;
    case 'sharp left':
      return Icons.turn_sharp_left;
    case 'right':
    case 'slight right':
      return Icons.turn_right;
    case 'sharp right':
      return Icons.turn_sharp_right;
    case 'uturn':
    case 'u-turn':
      return Icons.u_turn_left;
    case 'straight':
    case 'continue':
      return Icons.straight;
    case 'merge':
      return Icons.merge_type; // dedicated merge icon
    case 'roundabout':
    case 'rotary':
      return Icons.roundabout_left;
    case 'arrive':
    case 'destination':
      return Icons.flag;
    case 'depart':
    case 'head':
      return Icons.near_me;
    default:
      return Icons.navigation;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-widgets
// ──────────────────────────────────────────────────────────────────────────────

/// A coloured pill chip showing the driver's current road shield and direction.
///
/// The chip background reflects the road classification (blue for interstates,
/// green for US highways, teal for state routes, grey for local roads).
/// A small "ON" label in white above the chip distinguishes it from the
/// [NextRoadChip].
class CurrentRoadChip extends StatelessWidget {
  const CurrentRoadChip({super.key, required this.road});

  /// Road the driver is currently travelling on.
  final RoadInfo road;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // "ON" label identifies this chip as the current road.
        const Text(
          'ON',
          style: TextStyle(
            color: Colors.white54,
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 2),
        _RoadChip(road: road),
      ],
    );
  }
}

/// A coloured pill chip showing the road the driver should merge or turn onto.
///
/// Paired with [CurrentRoadChip] in the [RoadGuidanceBanner] to give the
/// driver an at-a-glance view of both the current and the target road.
class NextRoadChip extends StatelessWidget {
  const NextRoadChip({super.key, required this.road});

  /// Road the driver should transition onto.
  final RoadInfo road;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // "ONTO" label identifies this chip as the destination road.
        const Text(
          'ONTO',
          style: TextStyle(
            color: Colors.white54,
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 2),
        _RoadChip(road: road),
      ],
    );
  }
}

/// A green rounded chip displaying an exit number (e.g. "EXIT 352B").
///
/// Visible only when [ManeuverInfo.exitNumber] is non-null.  Styled to
/// match real-world highway exit signage green.
class ExitChip extends StatelessWidget {
  const ExitChip({super.key, required this.exitNumber});

  /// Exit label text, e.g. "352B".
  final String exitNumber;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        // MUTCD exit-sign green.
        color: const Color(0xFF2E7D32),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.white24, width: 0.5),
      ),
      child: Text(
        'EXIT $exitNumber',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

/// A horizontal row showing a lane-use directive to the driver.
///
/// Rendered below the instruction text when [ManeuverInfo.laneHint] is
/// non-null.  The road-fork icon reinforces the lane-selection action.
class LaneGuidanceRow extends StatelessWidget {
  const LaneGuidanceRow({super.key, required this.hint});

  /// Short directive, e.g. "Use right 2 lanes".
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(
          Icons.fork_right,
          color: Colors.white70,
          size: 15,
        ),
        const SizedBox(width: 4),
        Text(
          hint,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

/// A dimmed preview line showing the road that follows the immediate maneuver.
///
/// Equivalent to "Then take I-285 E" — helps the driver anticipate the next
/// action so they are never caught by surprise.  Only rendered when
/// [ManeuverInfo.thenRoad] is non-null.
class ThenRoadPreview extends StatelessWidget {
  const ThenRoadPreview({super.key, required this.road});

  /// Road that follows the immediate next maneuver.
  final RoadInfo road;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Then:',
          style: TextStyle(
            color: Colors.white38,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(width: 4),
        // Inline miniature road chip — same colour coding as the full chips.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: roadChipColor(road.routeType).withOpacity(0.75),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            roadChipLabel(road),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary banner widget
// ──────────────────────────────────────────────────────────────────────────────

/// Full-featured truck navigation banner with road-shield chips, exit info,
/// lane guidance, and a "then …" preview.
///
/// Designed for professional CDL drivers who need more context than a basic
/// turn-by-turn app provides.  The banner surfaces:
///   • Current road  (coloured chip, e.g. "I-10 W")
///   • Maneuver arrow icon (merge, turn-right, etc.)
///   • Distance to maneuver
///   • Primary instruction text (large, bold, 2-line max)
///   • Next road chip (e.g. "I-75 N")
///   • Exit number (green chip, e.g. "EXIT 352B")
///   • Lane hint (e.g. "Use right 2 lanes")
///   • Then-road preview (dimmed mini chip for the step after next)
///
/// Integration example (inside [TruckMapScreen.build]):
///
///   Stack(
///     children: [
///       FlutterMap(...),
///       Positioned(
///         top: 0, left: 0, right: 0,
///         child: RoadGuidanceBanner(maneuver: _currentManeuver),
///       ),
///     ],
///   )
///
/// Pass [sampleManeuver] during development; swap for live [ManeuverInfo]
/// data from the Mapbox Directions API at runtime.
class RoadGuidanceBanner extends StatelessWidget {
  const RoadGuidanceBanner({
    super.key,
    required this.maneuver,
  });

  /// The current turn-by-turn step to display.
  final ManeuverInfo maneuver;

  @override
  Widget build(BuildContext context) {
    final distanceLabel = formatGuidanceDistance(maneuver.distanceMeters);

    return SafeArea(
      bottom: false,
      child: Padding(
        // Uniform horizontal + top padding so the banner floats above the map
        // with rounded corners visible on all sides.
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Container(
          // Banner is centred horizontally, constrained to a readable width on
          // tablets while occupying the full width on phones.
          alignment: Alignment.center,
          decoration: BoxDecoration(
            // Dark semi-transparent background with a slight blue tint matches
            // professional truck GPS hardware aesthetics.
            color: const Color(0xE6151C2B),
            borderRadius: BorderRadius.circular(16),
            boxShadow: const [
              BoxShadow(
                color: Color(0x66000000),
                blurRadius: 12,
                offset: Offset(0, 4),
              ),
            ],
            border: Border.all(
              color: Colors.white12,
              width: 0.5,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── Row 1: current-road chip · maneuver icon · distance ──────
                Row(
                  children: [
                    // Current road chip (left side — "where am I now").
                    CurrentRoadChip(road: maneuver.currentRoad),
                    const SizedBox(width: 10),
                    // Maneuver direction arrow (centre).
                    Icon(
                      maneuverIconData(maneuver.maneuverType),
                      color: Colors.white,
                      size: 32,
                    ),
                    const Spacer(),
                    // Distance to maneuver (right side, bold for readability).
                    Text(
                      distanceLabel,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                // ── Row 2: primary instruction text ─────────────────────────
                // Large, bold text is legible at arm's length inside a truck cab.
                Text(
                  maneuver.instruction,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    height: 1.25,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.left,
                ),

                const SizedBox(height: 8),

                // ── Row 3: next road chip + optional exit chip ───────────────
                Row(
                  children: [
                    NextRoadChip(road: maneuver.nextRoad),
                    if (maneuver.exitNumber != null) ...[
                      const SizedBox(width: 10),
                      ExitChip(exitNumber: maneuver.exitNumber!),
                    ],
                  ],
                ),

                // ── Row 4: optional lane guidance ────────────────────────────
                if (maneuver.laneHint != null) ...[
                  const SizedBox(height: 6),
                  LaneGuidanceRow(hint: maneuver.laneHint!),
                ],

                // ── Row 5: optional "then …" road preview ────────────────────
                if (maneuver.thenRoad != null) ...[
                  const SizedBox(height: 4),
                  ThenRoadPreview(road: maneuver.thenRoad!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Private helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Internal coloured pill chip used by both [CurrentRoadChip] and [NextRoadChip].
///
/// Not exported — consumers should use the labelled wrapper widgets above so
/// the "ON" / "ONTO" context labels are always rendered consistently.
class _RoadChip extends StatelessWidget {
  const _RoadChip({required this.road});

  final RoadInfo road;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: roadChipColor(road.routeType),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white24, width: 0.5),
      ),
      child: Text(
        roadChipLabel(road),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 14,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}
