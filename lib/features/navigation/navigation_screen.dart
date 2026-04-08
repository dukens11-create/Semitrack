import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../../core/widgets.dart';

// ---------------------------------------------------------------------------
// Placeholder types – replace with real implementations when integrating.
// ---------------------------------------------------------------------------

/// Minimal placeholder that represents the data shown in the top-of-screen
/// instruction banner during active navigation.
///
/// Replace this with the real [TopInstructionData] class once it is defined
/// elsewhere in the codebase.
class TopInstructionData {
  const TopInstructionData({
    required this.visualType,
    required this.primaryText,
    required this.roadName,
    required this.distanceMiles,
    this.bottomChipText,
  });

  /// Icon/visual key that identifies the maneuver type (e.g. `'turn_left'`).
  final String visualType;

  /// Primary instruction verb phrase, e.g. `'Turn left onto'`.
  final String primaryText;

  /// Road name shown in the banner.
  final String roadName;

  /// Remaining distance to the maneuver, in miles.
  final double distanceMiles;

  /// Optional chip text shown at the bottom of the instruction card.
  final String? bottomChipText;

  @override
  String toString() => 'TopInstructionData('
      'visualType: $visualType, '
      'primaryText: $primaryText, '
      'roadName: $roadName, '
      'distanceMiles: $distanceMiles, '
      'bottomChipText: $bottomChipText)';
}

/// Maps a Mapbox maneuver [maneuverType] + [modifier] to a simple visual-type
/// token used by the instruction banner (e.g. an icon key).
///
/// This is a stub – replace it with a full implementation once the real icon
/// set and visual-type enum are decided.
String _mapStepToVisualType(String? maneuverType, String? modifier) {
  final type = (maneuverType ?? '').toLowerCase();
  final mod = (modifier ?? '').toLowerCase();

  if (type == 'turn') {
    if (mod == 'slight left') return 'bear_left';
    if (mod == 'slight right') return 'bear_right';
    if (mod == 'left' || mod == 'sharp left') return 'turn_left';
    if (mod == 'right' || mod == 'sharp right') return 'turn_right';
  }
  if (type == 'fork') {
    if (mod == 'left' || mod == 'slight left') return 'fork_left';
    if (mod == 'right' || mod == 'slight right') return 'fork_right';
    return 'fork';
  }
  if (type == 'merge') return 'merge';
  if (type == 'roundabout') return 'roundabout';
  if (type == 'off ramp' || type == 'exit') return 'exit';
  if (type == 'on ramp' || type == 'ramp') return 'ramp';
  if (type == 'depart') return 'depart';
  return 'straight';
}

class NavigationScreen extends StatelessWidget {
  const NavigationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Route points are populated from live GPS once navigation is active.
    // A static preview polyline is not shown here to avoid hardcoding a location.
    const List<LatLng> routePoints = [];

    return ListView(
      children: [
        SizedBox(
          height: 320,
          child: FlutterMap(
            options: const MapOptions(
              // Use a neutral US center; the map will follow the device
              // GPS location once navigation begins in TruckMapScreen.
              initialCenter: LatLng(39.5, -98.35),
              initialZoom: 8,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.semitrack.mobile',
              ),
              PolylineLayer(polylines: [Polyline(points: routePoints, strokeWidth: 5)]),
              MarkerLayer(markers: [
                Marker(
                  point: routePoints.first,
                  width: 40,
                  height: 40,
                  child: const Icon(Icons.local_shipping, size: 34),
                ),
              ]),
            ],
          ),
        ),
        const SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Live Truck Route', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              SizedBox(height: 12),
              LabelValue(label: 'Next maneuver', value: 'Take Exit 221 toward freight corridor'),
              LabelValue(label: 'ETA', value: '7h 50m'),
              LabelValue(label: 'Distance', value: '438 mi'),
              LabelValue(label: 'Mode', value: 'Fastest'),
              LabelValue(label: 'Traffic', value: 'Moderate'),
              LabelValue(label: 'Warnings', value: 'Low bridge avoided automatically'),
              LabelValue(label: 'Voice', value: 'Enabled'),
              LabelValue(label: 'Lane guidance', value: 'Available'),
              LabelValue(label: 'Junction view', value: 'Available'),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Navigation instruction helpers
// ---------------------------------------------------------------------------

/// Selects the best road name to display in the instruction banner.
///
/// Each candidate is tested in priority order: [roadName] first, then
/// [nextRoadName], then [currentRoadName], and finally [highwayName].
/// The first value that is non-null and not considered a placeholder
/// (empty string or `"unnamed road"`, case-insensitive) is returned.
/// If no usable name is found an empty string is returned.
String _resolveDisplayRoadName({
  String? roadName,
  String? currentRoadName,
  String? nextRoadName,
  String? highwayName,
}) {
  bool isBad(String? v) {
    if (v == null) return true;
    final t = v.trim().toLowerCase();
    return t.isEmpty || t == 'unnamed road';
  }

  if (!isBad(roadName)) return roadName!.trim();
  if (!isBad(nextRoadName)) return nextRoadName!.trim();
  if (!isBad(currentRoadName)) return currentRoadName!.trim();
  if (!isBad(highwayName)) return highwayName!.trim();
  return '';
}

/// Builds the primary instruction verb phrase for a navigation step.
///
/// The returned string is intended to appear before the road name in the
/// instruction banner, e.g. `"Turn left onto"`.  The `"slight"` modifier
/// variants are checked before the plain `"left"`/`"right"` variants so that
/// the more specific description always wins.
///
/// * [maneuverType] – Mapbox maneuver type string (e.g. `'turn'`, `'fork'`).
/// * [modifier] – Optional Mapbox modifier string (e.g. `'left'`, `'slight right'`).
String _buildPrimaryInstructionText(String? maneuverType, String? modifier) {
  final type = (maneuverType ?? '').toLowerCase();
  final mod = (modifier ?? '').toLowerCase();

  if (type == 'depart') return 'Head out';
  if (type == 'continue' || type == 'new name') return 'Continue on';
  if (type == 'merge') return 'Merge onto';
  if (type == 'fork') {
    if (mod == 'left' || mod == 'slight left') return 'Keep left for';
    return 'Keep right for';
  }
  if (type == 'off ramp' || type == 'exit') return 'Take exit to';
  if (type == 'on ramp' || type == 'ramp') return 'Take ramp to';
  if (type == 'roundabout') return 'Enter roundabout for';
  if (type == 'turn') {
    if (mod == 'slight left') return 'Bear left onto';
    if (mod == 'slight right') return 'Bear right onto';
    if (mod == 'left' || mod == 'sharp left') return 'Turn left onto';
    if (mod == 'right' || mod == 'sharp right') return 'Turn right onto';
  }
  return 'Continue ahead';
}

/// Updates the top instruction banner from the data of a single navigation step.
///
/// Resolves the best available road name via [_resolveDisplayRoadName] and
/// derives the primary instruction verb phrase via [_buildPrimaryInstructionText],
/// then constructs a [TopInstructionData] value.
///
/// **Demonstration mode:** the result is printed to the console.  When
/// integrating this into a real [StatefulWidget], replace the `print` call
/// with `setState(() { _topInstructionData = data; })`.
///
/// * [maneuverType] – Mapbox maneuver type string.
/// * [modifier] – Optional Mapbox modifier string.
/// * [roadName] – Primary road name for the upcoming step.
/// * [currentRoadName] – Name of the road the driver is currently on.
/// * [nextRoadName] – Name of the road after the next turn.
/// * [highwayName] – Highway reference (e.g. `'I-90'`), used as a fallback.
/// * [distanceMiles] – Distance to the next maneuver, in miles.
void _updateTopInstructionFromNavigationStep({
  required String? maneuverType,
  required String? modifier,
  required String? roadName,
  String? currentRoadName,
  String? nextRoadName,
  String? highwayName,
  required double distanceMiles,
}) {
  final displayRoadName = _resolveDisplayRoadName(
    roadName: roadName,
    currentRoadName: currentRoadName,
    nextRoadName: nextRoadName,
    highwayName: highwayName,
  );

  final primary = _buildPrimaryInstructionText(maneuverType, modifier);

  final data = TopInstructionData(
    visualType: _mapStepToVisualType(maneuverType, modifier),
    primaryText: primary,
    roadName: displayRoadName.isEmpty ? primary : displayRoadName,
    distanceMiles: distanceMiles,
    bottomChipText: displayRoadName.isEmpty ? null : displayRoadName,
  );

  // Demonstration output – replace with setState(() { _topInstructionData = data; })
  // when integrating into a StatefulWidget.
  // Only log in debug builds to avoid emitting internal state to production logs.
  if (kDebugMode) {
    debugPrint('[NavigationScreen] TopInstruction: $data');
  }
}
