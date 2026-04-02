import 'package:flutter/material.dart';

// ── Enums ─────────────────────────────────────────────────────────────────────

enum RouteType {
  interstate,
  usHighway,
  stateRoute,
  localRoad,
}

enum ManeuverType {
  continueStraight,
  merge,
  keepLeft,
  keepRight,
  exitRight,
  exitLeft,
  turnLeft,
  turnRight,
  forkLeft,
  forkRight,
  uTurn,
  ramp,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

String roadTypePrefix(RouteType type) {
  switch (type) {
    case RouteType.interstate:
      return 'I-';
    case RouteType.usHighway:
      return 'US-';
    case RouteType.stateRoute:
      return 'SR-';
    case RouteType.localRoad:
      return '';
  }
}

String formatDistanceMeters(double meters) {
  if (meters < 50) return 'Now';
  if (meters < 1000) return '${meters.toInt()} m';
  final km = meters / 1000;
  return '${km.toStringAsFixed(1)} km';
}

Color routeChipColor(RouteType type) {
  switch (type) {
    case RouteType.interstate:
      return Colors.blue.shade800;
    case RouteType.usHighway:
      return Colors.black87;
    case RouteType.stateRoute:
      return Colors.green.shade800;
    case RouteType.localRoad:
      return Colors.grey.shade700;
  }
}

IconData maneuverIcon(ManeuverType type) {
  switch (type) {
    case ManeuverType.continueStraight:
      return Icons.straight;
    case ManeuverType.merge:
      return Icons.merge;
    case ManeuverType.keepLeft:
      return Icons.turn_slight_left;
    case ManeuverType.keepRight:
      return Icons.turn_slight_right;
    case ManeuverType.exitRight:
      return Icons.exit_to_app;
    case ManeuverType.exitLeft:
      return Icons.exit_to_app;
    case ManeuverType.turnLeft:
      return Icons.turn_left;
    case ManeuverType.turnRight:
      return Icons.turn_right;
    case ManeuverType.forkLeft:
      return Icons.fork_left;
    case ManeuverType.forkRight:
      return Icons.fork_right;
    case ManeuverType.uTurn:
      return Icons.u_turn_left;
    case ManeuverType.ramp:
      return Icons.ramp_right;
  }
}

// ── Models ────────────────────────────────────────────────────────────────────

class RoadInfo {
  final String routeNumber;
  final String? routeName;
  final RouteType routeType;
  final String? direction;

  const RoadInfo({
    required this.routeNumber,
    this.routeName,
    required this.routeType,
    this.direction,
  });

  String get fullLabel {
    final prefix = roadTypePrefix(routeType);
    final dir = (direction == null || direction!.isEmpty) ? '' : ' $direction';
    final base = '$prefix$routeNumber$dir';
    return (routeName != null && routeName!.isNotEmpty)
        ? '$base ${routeName!}'
        : base;
  }
}

class ManeuverInfo {
  final String instruction;
  final ManeuverType maneuverType;
  final double distanceMeters;
  final String? exitNumber;
  final String? laneHint;
  final RoadInfo currentRoad;
  final RoadInfo? nextRoad;
  final RoadInfo? thenRoad;
  final String? towardText;

  const ManeuverInfo({
    required this.instruction,
    required this.maneuverType,
    required this.distanceMeters,
    this.exitNumber,
    this.laneHint,
    required this.currentRoad,
    this.nextRoad,
    this.thenRoad,
    this.towardText,
  });
}

// ── Widgets ───────────────────────────────────────────────────────────────────

/// Displays a road-shield chip (e.g. "I-10 W") styled by [RouteType].
class RoadChip extends StatelessWidget {
  final RoadInfo road;

  const RoadChip({super.key, required this.road});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: routeChipColor(road.routeType),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        road.fullLabel,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 13,
        ),
      ),
    );
  }
}

/// Displays a green highway-exit chip (e.g. "Exit 352B").
class ExitChip extends StatelessWidget {
  final String exitNumber;

  const ExitChip({super.key, required this.exitNumber});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.green.shade800,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        'Exit $exitNumber',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 13,
        ),
      ),
    );
  }
}

/// Shows a lane-guidance hint with a stream icon.
class LaneGuidanceRow extends StatelessWidget {
  final String laneHint;

  const LaneGuidanceRow({super.key, required this.laneHint});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.view_stream, color: Colors.white70, size: 18),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            laneHint,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}

/// "Then → [road chip]" preview of the road after next.
class ThenRoadPreview extends StatelessWidget {
  final RoadInfo road;

  const ThenRoadPreview({super.key, required this.road});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Text(
          'Then',
          style: TextStyle(
            color: Colors.white54,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 8),
        RoadChip(road: road),
      ],
    );
  }
}

/// Full GPS-style road/highway guidance banner.
///
/// Floats over the map (inside a [Stack]) when [_isNavigating] is `true`.
/// Includes the maneuver icon, instruction text, distance, road chips,
/// lane guidance, and then-road preview.  Wraps itself in [SafeArea] so
/// the card never overlaps the system status bar.
class RoadGuidanceBanner extends StatelessWidget {
  final ManeuverInfo maneuver;

  const RoadGuidanceBanner({super.key, required this.maneuver});

  @override
  Widget build(BuildContext context) {
    final secondaryText =
        (maneuver.towardText == null || maneuver.towardText!.trim().isEmpty)
            ? null
            : maneuver.towardText;

    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.92),
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.22),
                blurRadius: 14,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── Top row: icon | instruction | distance ───────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Maneuver icon
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: Colors.white12,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(
                      maneuverIcon(maneuver.maneuverType),
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Instruction + toward text
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          maneuver.instruction,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            height: 1.15,
                          ),
                        ),
                        if (secondaryText != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            secondaryText,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Distance to maneuver
                  Text(
                    formatDistanceMeters(maneuver.distanceMeters),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              // ── Road + exit chips ─────────────────────────────────────────
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  RoadChip(road: maneuver.currentRoad),
                  if (maneuver.nextRoad != null)
                    RoadChip(road: maneuver.nextRoad!),
                  if (maneuver.exitNumber != null)
                    ExitChip(exitNumber: maneuver.exitNumber!),
                ],
              ),
              // ── Lane guidance ─────────────────────────────────────────────
              if (maneuver.laneHint != null &&
                  maneuver.laneHint!.trim().isNotEmpty) ...[
                const SizedBox(height: 10),
                LaneGuidanceRow(laneHint: maneuver.laneHint!),
              ],
              // ── Then-road preview ─────────────────────────────────────────
              if (maneuver.thenRoad != null) ...[
                const SizedBox(height: 10),
                ThenRoadPreview(road: maneuver.thenRoad!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
