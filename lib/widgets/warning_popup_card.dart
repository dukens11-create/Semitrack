import 'package:flutter/material.dart';

import '../models/warning_sign.dart';
import '../services/warning_manager.dart';

/// Returns the [IconData] that best represents [type] for display in a
/// [WarningPopupCard].
///
/// Falls back to [Icons.warning_amber_rounded] for any unrecognised variant
/// so new [WarningType] values are safe to add before updating this helper.
IconData warningIconData(WarningType type) {
  switch (type) {
    case WarningType.lowBridge:
      return Icons.height;
    case WarningType.weightRestriction:
      return Icons.scale;
    case WarningType.noTrucks:
      return Icons.do_not_disturb_alt;
    case WarningType.hazmatRestriction:
      return Icons.dangerous;
    case WarningType.steepGrade:
      return Icons.terrain;
    case WarningType.sharpCurve:
      return Icons.turn_left;
    case WarningType.runawayTruckRamp:
      return Icons.emergency;
    case WarningType.chainRequirement:
      return Icons.link;
    case WarningType.highWindArea:
      return Icons.air;
    case WarningType.constructionZone:
      return Icons.construction;
    case WarningType.accidentAhead:
      return Icons.warning_amber_rounded;
    case WarningType.laneClosure:
      return Icons.close;
    case WarningType.roadClosed:
      return Icons.block;
    case WarningType.detour:
      return Icons.alt_route;
    case WarningType.weighStation:
      return Icons.scale;
    case WarningType.brakeCheckArea:
      return Icons.stop_circle;
    case WarningType.restArea:
      return Icons.hotel;
    case WarningType.animalCrossing:
      return Icons.pets;
    case WarningType.portOfEntry:
      return Icons.border_all;
    case WarningType.icyRoad:
      return Icons.ac_unit;
    case WarningType.floodingRoad:
      return Icons.water;
  }
}

/// Returns the background [Color] for a warning card based on [severity].
Color warningSeverityColor(WarningSeverity severity) {
  switch (severity) {
    case WarningSeverity.high:
      return const Color(0xFFD32F2F); // red[700]
    case WarningSeverity.medium:
      return const Color(0xFFE65100); // deepOrange[900]
    case WarningSeverity.low:
      return const Color(0xFF1565C0); // blue[800]
  }
}

/// A compact popup card that notifies the driver of a single road hazard.
///
/// Displays the warning [icon], [title], [message], the distance ahead, and a
/// close button.  The card background colour reflects the [severity] of the
/// sign:  red → high, orange → medium, blue → low.
///
/// Typically rendered by [WarningPopupStack] which manages the vertical list
/// and animation.  Can also be used standalone in tests or story previews.
class WarningPopupCard extends StatelessWidget {
  const WarningPopupCard({
    super.key,
    required this.warning,
    required this.onDismiss,
  });

  /// The active warning to display.
  final ActiveWarning warning;

  /// Callback invoked when the driver taps the close (✕) button.
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final sign = warning.sign;
    final Color cardColor = warningSeverityColor(sign.severity);
    final IconData icon = warningIconData(sign.type);

    // Format distance: show "< 0.1 mi" for very close signs, otherwise
    // round to one decimal place.
    final String distLabel = warning.distanceMiles < 0.1
        ? '< 0.1 mi ahead'
        : '${warning.distanceMiles.toStringAsFixed(1)} mi ahead';

    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(12),
      color: Colors.transparent,
      child: Container(
        width: 240,
        decoration: BoxDecoration(
          color: cardColor,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.35),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Icon ──────────────────────────────────────────────────────
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.20),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: Colors.white, size: 22),
              ),
              const SizedBox(width: 10),

              // ── Text content ──────────────────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      sign.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      sign.message,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.90),
                        fontSize: 11,
                        height: 1.3,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          Icons.place,
                          size: 11,
                          color: Colors.white.withOpacity(0.80),
                        ),
                        const SizedBox(width: 3),
                        Text(
                          distLabel,
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.80),
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // ── Close button ──────────────────────────────────────────────
              GestureDetector(
                onTap: onDismiss,
                behavior: HitTestBehavior.opaque,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    Icons.close,
                    size: 16,
                    color: Colors.white.withOpacity(0.80),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
