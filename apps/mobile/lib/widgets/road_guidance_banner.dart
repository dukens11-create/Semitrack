import 'package:flutter/material.dart';

// ── Enums ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

/// Returns the conventional prefix for a road type, e.g. "I-" for interstates.
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

/// Returns a human-readable distance string from raw metres.
///
/// Below 50 m the driver is essentially at the maneuver, so "Now" is shown.
/// Below 1 000 m the distance is shown in whole metres.
/// At or above 1 000 m a one-decimal-place km value is used.
String formatDistanceMeters(double meters) {
  if (meters < 50) return 'Now';
  if (meters < 1000) return '${meters.toInt()} m';
  final km = meters / 1000;
  return '${km.toStringAsFixed(1)} km';
}

/// Returns the background chip color for each [RouteType].
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

/// Returns the [IconData] that best represents a [ManeuverType].
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

/// Builds the display label for a [RoadInfo], including type prefix and
/// optional direction suffix.
String buildRoadLabel(RoadInfo road) => road.fullLabel;

// ── Models ─────────────────────────────────────────────────────────────────

/// Identifies a specific road segment by number, name, type, and direction.
class RoadInfo {
  const RoadInfo({
    required this.routeNumber,
    this.routeName,
    required this.routeType,
    this.direction,
  });

  /// Route shield number, e.g. "10", "75", "41".
  final String routeNumber;

  /// Optional full name of the road, e.g. "Santa Monica Freeway".
  final String? routeName;

  /// Road classification used for shield colour and prefix.
  final RouteType routeType;

  /// Cardinal or compass direction, e.g. "N", "W", "NE".
  final String? direction;

  /// Full label shown on chips and previews, e.g. "I-10 W".
  String get fullLabel {
    final prefix = roadTypePrefix(routeType);
    final dir = (direction == null || direction!.isEmpty) ? '' : ' $direction';
    final base = '$prefix$routeNumber$dir';
    return (routeName != null && routeName!.isNotEmpty)
        ? '$base ${routeName!}'
        : base;
  }
}

/// All information required to render a single guidance banner frame.
class ManeuverInfo {
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

  /// Primary instruction shown in bold, e.g. "Keep right to merge onto I-75 N".
  final String instruction;

  /// Maneuver category used to select the icon.
  final ManeuverType maneuverType;

  /// Distance to the upcoming maneuver in metres.
  final double distanceMeters;

  /// Exit number, e.g. "352B".  Null when there is no exit.
  final String? exitNumber;

  /// Lane recommendation, e.g. "Use right 2 lanes".
  final String? laneHint;

  /// Road the driver is currently on.
  final RoadInfo currentRoad;

  /// Road the driver will be on after the upcoming maneuver.
  final RoadInfo? nextRoad;

  /// Road that follows the [nextRoad], shown as a look-ahead preview.
  final RoadInfo? thenRoad;

  /// Toward text, e.g. "toward Atlanta".
  final String? towardText;
}

// ── Widgets ────────────────────────────────────────────────────────────────

/// Coloured pill chip that shows a road shield number and direction.
///
/// Color is determined by [RouteType] (blue=interstate, black=US highway,
/// green=state route, grey=local road).
class RoadChip extends StatelessWidget {
  const RoadChip({super.key, required this.road});

  final RoadInfo road;

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

/// Green pill chip showing the upcoming exit number.
class ExitChip extends StatelessWidget {
  const ExitChip({super.key, required this.exitNumber});

  final String exitNumber;

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

/// A single row showing a lane-guidance hint with a lanes icon.
class LaneGuidanceRow extends StatelessWidget {
  const LaneGuidanceRow({super.key, required this.laneHint});

  final String laneHint;

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

/// "Then → [RoadChip]" look-ahead row shown at the bottom of the banner.
class ThenRoadPreview extends StatelessWidget {
  const ThenRoadPreview({super.key, required this.road});

  final RoadInfo road;

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

/// Full-featured road/highway guidance banner for truck navigation.
///
/// Layout (top → bottom):
/// ```
/// ┌─────────────────────────────────────────────────────┐
/// │ [icon]  instruction text              distance       │
/// │         toward text (optional)                       │
/// ├─────────────────────────────────────────────────────┤
/// │ [CurrentRoad] [NextRoad] [Exit chip]                 │
/// │ 🛣 lane hint (optional)                              │
/// │ Then [ThenRoad chip] (optional)                      │
/// └─────────────────────────────────────────────────────┘
/// ```
///
/// Wrap in a [Positioned] or place inside a [Stack] at the top of the map
/// to float it over the map widget.  [SafeArea] padding is applied
/// internally so the banner never overlaps the status-bar on notched phones.
class RoadGuidanceBanner extends StatelessWidget {
  const RoadGuidanceBanner({super.key, required this.maneuver});

  final ManeuverInfo maneuver;

  @override
  Widget build(BuildContext context) {
    final towardText =
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
              // ── Top row: icon | instruction | distance ──────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
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
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (towardText != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            towardText,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Distance badge (right-aligned).
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
              const SizedBox(height: 12),
              // ── Road + exit chips ────────────────────────────────────────
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
              // ── Lane guidance ────────────────────────────────────────────
              if (maneuver.laneHint != null &&
                  maneuver.laneHint!.trim().isNotEmpty) ...[
                const SizedBox(height: 10),
                LaneGuidanceRow(laneHint: maneuver.laneHint!),
              ],
              // ── Then-road look-ahead ──────────────────────────────────────
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

// ── Demo Page ──────────────────────────────────────────────────────────────

/// Standalone demo page that renders [RoadGuidanceBanner] with realistic
/// sample data.  Use this screen to preview the banner in isolation or as a
/// quick integration test.
///
/// To display the demo from anywhere in the app:
/// ```dart
/// Navigator.push(
///   context,
///   MaterialPageRoute(builder: (_) => const RoadGuidanceDemoPage()),
/// );
/// ```
class RoadGuidanceDemoPage extends StatelessWidget {
  const RoadGuidanceDemoPage({super.key});

  @override
  Widget build(BuildContext context) {
    // ── Sample data matching the spec ──────────────────────────────────────
    const currentRoad = RoadInfo(
      routeNumber: '10',
      routeType: RouteType.interstate,
      direction: 'W',
    );
    const nextRoad = RoadInfo(
      routeNumber: '75',
      routeType: RouteType.interstate,
      direction: 'N',
    );
    const thenRoad = RoadInfo(
      routeNumber: '41',
      routeType: RouteType.usHighway,
      direction: 'N',
    );
    const maneuver = ManeuverInfo(
      instruction: 'Keep right to merge onto I-75 N toward Atlanta',
      maneuverType: ManeuverType.keepRight,
      distanceMeters: 1931,
      exitNumber: '352B',
      laneHint: 'Use right 2 lanes',
      currentRoad: currentRoad,
      nextRoad: nextRoad,
      thenRoad: thenRoad,
      towardText: 'toward Atlanta',
    );

    return Scaffold(
      backgroundColor: Colors.grey.shade700,
      appBar: AppBar(
        title: const Text('Road Guidance Banner – Demo'),
        backgroundColor: Colors.black87,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        children: [
          // Placeholder map background.
          Container(color: Colors.grey.shade600),
          const RoadGuidanceBanner(maneuver: maneuver),
        ],
      ),
    );
  }
}
