import 'dart:async';

import 'package:flutter/material.dart';

import '../models/warning_sign.dart';
import '../services/warning_manager.dart';
import 'warning_popup_card.dart';

/// Auto-dismiss durations by severity.
///
/// High severity warnings are never auto-dismissed — the driver must tap
/// the close button explicitly.  Medium and low warnings disappear after a
/// fixed interval so the stack does not accumulate stale entries.
const Duration _kMediumAutoDismiss = Duration(seconds: 10);
const Duration _kLowAutoDismiss = Duration(seconds: 6);

/// Stacked overlay that shows all currently active truck-navigation warning
/// popups anchored to the top-right corner of the map screen.
///
/// Each card slides in from the right when it appears (using
/// [SlideTransition] + [AnimationController]) and fades out on dismiss.
/// Non-high severity cards are also auto-dismissed after a fixed interval
/// ([_kMediumAutoDismiss] / [_kLowAutoDismiss]).  High-severity cards stay
/// pinned until the driver taps the close button.
///
/// ## Usage
///
/// Place inside the [Stack] that holds the map and navigation overlay:
///
/// ```dart
/// Positioned(
///   top: 80, // below the nav banner
///   right: 8,
///   child: WarningPopupStack(manager: _warningManager),
/// )
/// ```
///
/// [WarningPopupStack] listens to [WarningManager] directly via
/// [AnimatedBuilder] so it rebuilds only when [activePopups] changes, without
/// forcing a full-screen [setState] in the parent.
class WarningPopupStack extends StatefulWidget {
  const WarningPopupStack({super.key, required this.manager});

  /// The [WarningManager] whose [activePopups] list drives this widget.
  final WarningManager manager;

  @override
  State<WarningPopupStack> createState() => _WarningPopupStackState();
}

class _WarningPopupStackState extends State<WarningPopupStack>
    with TickerProviderStateMixin {
  // ── Per-card animation state ───────────────────────────────────────────────

  /// Maps warning-sign ID → [AnimationController] for slide-in animation.
  final Map<String, AnimationController> _controllers = {};

  /// Maps warning-sign ID → auto-dismiss [Timer] for non-high severity cards.
  final Map<String, Timer> _dismissTimers = {};

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    for (final t in _dismissTimers.values) {
      t.cancel();
    }
    super.dispose();
  }

  // ── Controller helpers ────────────────────────────────────────────────────

  /// Returns (creating if necessary) the [AnimationController] for [id].
  AnimationController _controllerFor(String id) {
    return _controllers.putIfAbsent(
      id,
      () {
        final ctrl = AnimationController(
          vsync: this,
          duration: const Duration(milliseconds: 320),
        )..forward();
        return ctrl;
      },
    );
  }

  /// Starts (or resets) the auto-dismiss timer for a non-high-severity card.
  void _scheduleDismiss(String id, WarningSeverity severity) {
    if (severity == WarningSeverity.high) return; // high = pinned
    if (_dismissTimers.containsKey(id)) return; // already scheduled

    final Duration delay = severity == WarningSeverity.medium
        ? _kMediumAutoDismiss
        : _kLowAutoDismiss;

    _dismissTimers[id] = Timer(delay, () => _dismiss(id));
  }

  /// Animates out then delegates to [WarningManager.dismiss].
  void _dismiss(String id) {
    _dismissTimers.remove(id)?.cancel();
    final ctrl = _controllers[id];
    if (ctrl != null) {
      ctrl.reverse().then((_) {
        widget.manager.dismiss(id);
        ctrl.dispose();
        _controllers.remove(id);
      });
    } else {
      widget.manager.dismiss(id);
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.manager,
      builder: (context, _) {
        final popups = widget.manager.activePopups;

        // Clean up controllers for warnings that are no longer active.
        final activeIds = popups.map((w) => w.sign.id).toSet();
        _controllers.keys
            .where((id) => !activeIds.contains(id))
            .toList()
            .forEach((id) {
          _controllers[id]?.dispose();
          _controllers.remove(id);
          _dismissTimers.remove(id)?.cancel();
        });

        if (popups.isEmpty) return const SizedBox.shrink();

        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: popups.map((warning) {
            final String id = warning.sign.id;
            final AnimationController ctrl = _controllerFor(id);

            // Schedule auto-dismiss for medium/low cards (idempotent).
            _scheduleDismiss(id, warning.sign.severity);

            final Animation<Offset> slide = Tween<Offset>(
              begin: const Offset(1.2, 0.0), // slides in from right
              end: Offset.zero,
            ).animate(
              CurvedAnimation(parent: ctrl, curve: Curves.easeOutCubic),
            );

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SlideTransition(
                position: slide,
                child: FadeTransition(
                  opacity: ctrl,
                  child: WarningPopupCard(
                    warning: warning,
                    onDismiss: () => _dismiss(id),
                  ),
                ),
              ),
            );
          }).toList(),
        );
      },
    );
  }
}
