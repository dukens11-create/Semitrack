import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:semitrack_mobile/screens/auth_screen.dart';
import 'package:semitrack_mobile/screens/documents_screen.dart';
import 'package:semitrack_mobile/screens/driver_dashboard_screen.dart';
import 'package:semitrack_mobile/screens/trips_screen.dart';
import 'package:semitrack_mobile/services/auth_service.dart';
import 'package:semitrack_mobile/theme/semitrack_theme.dart';

Widget _app(Widget screen, {ThemeMode themeMode = ThemeMode.light}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: SemiTrackTheme.light(),
    darkTheme: SemiTrackTheme.dark(),
    themeMode: themeMode,
    home: screen,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('phone-size driver surfaces remain visually stable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({});

    final dashboard = DriverDashboardScreen(
      user: const AuthUser(
        id: 'driver-1',
        email: 'driver@example.com',
        fullName: 'Dukens Bal',
        role: 'DRIVER',
        plan: 'PRO',
      ),
      onPlanTrip: () {},
      onTrips: () {},
      onDocuments: () {},
      onProfile: () {},
    );

    await tester.pumpWidget(_app(dashboard));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/home_day.png'),
    );

    await tester.pumpWidget(_app(dashboard, themeMode: ThemeMode.dark));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/home_night.png'),
    );

    await tester.pumpWidget(_app(TripsScreen(onPlanTrip: () {})));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/trips.png'),
    );

    await tester.pumpWidget(_app(const DocumentsScreen()));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/documents.png'),
    );

    await tester.pumpWidget(_app(AuthScreen(auth: AuthService())));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/auth.png'),
    );

    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    expect(find.text('Full name'), findsOneWidget);
    expect(find.text('Create your driver account'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
