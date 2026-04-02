import 'package:flutter/material.dart';

import '../models/warning_config.dart';
import '../services/warning_manager.dart';

/// A compact popup card that notifies the driver of a single road hazard.
///
/// Displays the warning icon, title, message, distance ahead, and a close
/// button.  The card background colour reflects the [WarningSign.severity] of
/// the sign (red → high, orange → medium, blue → low) via
/// [WarningConfig.colorForSeverity], while the icon is resolved from the type
/// via [WarningConfig.styleFor].
///
/// Typically rendered inside a [WarningPopupStack] which manages the vertical
/// list and slide-in animation.  Can also be used standalone in tests.
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
    final Color cardColor = WarningConfig.colorForSeverity(sign.severity);
    final style = WarningConfig.styleFor(sign.type);

    // Format distance: show "< 0.1 mi" for very close signs.
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
                child: Icon(style.icon, color: Colors.white, size: 22),
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
                    if (sign.message != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        sign.message!,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.90),
                          fontSize: 11,
                          height: 1.3,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
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
