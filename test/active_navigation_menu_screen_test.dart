import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/screens/active_navigation_menu_screen.dart';

Widget _menu() => const ActiveNavigationMenuScreen(
  instruction: 'Take exit 24 toward I-80 East',
  towardRoad: 'Reno',
  maneuverIcon: Icons.turn_slight_right_rounded,
  maneuverDistance: '1.4 mi',
  remainingDistance: '278 mi',
  remainingDuration: '5h 21m',
  arrivalTime: '3:22 AM PDT',
  audioLabel: 'Voice guidance on',
  truckName: 'Truck 1',
);

void main() {
  testWidgets('renders professional active-navigation controls', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(home: _menu()));

    expect(find.text('Take exit 24 toward I-80 East'), findsOneWidget);
    expect(find.text('toward Reno'), findsOneWidget);
    expect(find.text('278 mi'), findsOneWidget);
    expect(find.text('5h 21m'), findsOneWidget);
    expect(find.text('3:22 AM PDT'), findsOneWidget);
    expect(find.text('Quit Nav'), findsOneWidget);
    expect(find.text('Continue Navigation'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('returns shortcut action to active map', (tester) async {
    ActiveNavigationMenuAction? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => FilledButton(
            onPressed: () async {
              result = await Navigator.push<ActiveNavigationMenuAction>(
                context,
                MaterialPageRoute(builder: (_) => _menu()),
              );
            },
            child: const Text('Open navigation menu'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open navigation menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reroute'));
    await tester.pumpAndSettle();

    expect(result, ActiveNavigationMenuAction.reroute);
  });

  testWidgets('requires confirmation before quitting navigation', (
    tester,
  ) async {
    ActiveNavigationMenuAction? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => FilledButton(
            onPressed: () async {
              result = await Navigator.push<ActiveNavigationMenuAction>(
                context,
                MaterialPageRoute(builder: (_) => _menu()),
              );
            },
            child: const Text('Open navigation menu'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open navigation menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Quit Nav'));
    await tester.pumpAndSettle();

    expect(find.text('Quit navigation?'), findsOneWidget);
    expect(result, isNull);

    await tester.tap(find.text('Quit navigation'));
    await tester.pumpAndSettle();

    expect(result, ActiveNavigationMenuAction.quit);
  });
}
