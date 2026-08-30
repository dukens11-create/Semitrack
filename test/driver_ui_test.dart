import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:semitrack_mobile/screens/documents_screen.dart';
import 'package:semitrack_mobile/screens/driver_dashboard_screen.dart';
import 'package:semitrack_mobile/screens/trips_screen.dart';
import 'package:semitrack_mobile/theme/semitrack_theme.dart';

Widget _app(Widget child) => MaterialApp(
      theme: SemiTrackTheme.light(),
      darkTheme: SemiTrackTheme.dark(),
      home: child,
    );

void main() {
  testWidgets('home destination action opens the map flow', (tester) async {
    var openedPlanner = false;
    await tester.pumpWidget(
      _app(
        DriverDashboardScreen(
          user: null,
          onPlanTrip: () => openedPlanner = true,
          onTrips: () {},
          onDocuments: () {},
          onProfile: () {},
        ),
      ),
    );

    expect(find.text('Ready to roll, Driver?'), findsOneWidget);
    await tester.tap(find.text('Choose destination'));
    expect(openedPlanner, isTrue);
  });

  testWidgets('trips empty state keeps planning available', (tester) async {
    var openedPlanner = false;
    await tester.pumpWidget(
      _app(TripsScreen(onPlanTrip: () => openedPlanner = true)),
    );

    expect(find.text('No planned trips'), findsOneWidget);
    await tester.tap(find.text('Plan truck route'));
    expect(openedPlanner, isTrue);
  });

  testWidgets('document records persist on the device', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(_app(const DocumentsScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add document record'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).first,
      'Reno delivery BOL',
    );
    await tester.tap(find.text('Save record'));
    await tester.pumpAndSettle();

    expect(find.text('Reno delivery BOL'), findsOneWidget);
    expect(find.text('BOL'), findsWidgets);
  });
}
