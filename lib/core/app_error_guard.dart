import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../theme/semitrack_theme.dart';

/// Installs the last-resort Flutter and platform error handlers.
///
/// Feature code must still handle expected failures locally. This guard is for
/// unexpected framework/build/async failures: it keeps one broken widget from
/// replacing the application with Flutter's red diagnostic screen and records
/// a useful stack trace in debug builds without showing internals to drivers.
abstract final class AppErrorGuard {
  static bool _installed = false;

  static void install() {
    if (_installed) return;
    _installed = true;

    FlutterError.onError = (details) {
      if (kDebugMode) {
        FlutterError.dumpErrorToConsole(details, forceReport: true);
      } else {
        debugPrint(
          'SemiTrax recovered from a Flutter error '
          '(${details.exception.runtimeType}).',
        );
      }
    };

    PlatformDispatcher.instance.onError = (error, stack) {
      reportUncaught(error, stack);
      return true;
    };

    ErrorWidget.builder = (details) => SemiTrackErrorFallback(
      errorType: details.exception.runtimeType.toString(),
    );
  }

  static void reportUncaught(Object error, StackTrace stack) {
    debugPrint('SemiTrax recovered from an uncaught ${error.runtimeType}.');
    if (kDebugMode) {
      debugPrintStack(stackTrace: stack);
    }
  }
}

/// Driver-safe replacement for Flutter's red error screen.
class SemiTrackErrorFallback extends StatelessWidget {
  const SemiTrackErrorFallback({super.key, this.errorType});

  final String? errorType;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SemiTrackColors.navy,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Padding(
                  padding: EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.health_and_safety_rounded,
                        color: SemiTrackColors.orange,
                        size: 52,
                      ),
                      SizedBox(height: 16),
                      Text(
                        'This screen could not finish loading',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: SemiTrackColors.navy,
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 10),
                      Text(
                        'Your trip data is still protected. Use the Android Back button to return, then try the action again.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Color(0xFF526071),
                          fontSize: 15,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
