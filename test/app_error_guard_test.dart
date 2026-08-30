import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:semitrack_mobile/core/app_error_guard.dart';

void main() {
  testWidgets('driver-safe fallback replaces raw framework diagnostics', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SemiTrackErrorFallback(errorType: 'FrameworkAssertion'),
      ),
    );

    expect(find.text('This screen could not finish loading'), findsOneWidget);
    expect(find.textContaining('trip data is still protected'), findsOneWidget);
    expect(find.textContaining('framework.dart'), findsNothing);
    expect(find.byIcon(Icons.health_and_safety_rounded), findsOneWidget);
  });
}
