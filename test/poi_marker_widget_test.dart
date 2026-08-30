import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/utils/marker_widgets.dart';

void main() {
  testWidgets('POI marker uses shared outlined teardrop and category icon', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: buildGpsPinMarker(
              pinColor: const Color(0xFF1489C7),
              fallbackIcon: Icons.local_gas_station,
              pinSize: 58,
            ),
          ),
        ),
      ),
    );

    expect(find.byKey(const ValueKey<String>('poi-pin-shape')), findsOneWidget);
    expect(find.byIcon(Icons.local_gas_station), findsOneWidget);
    expect(
      tester.getSize(
        find
            .ancestor(
              of: find.byKey(const ValueKey<String>('poi-pin-shape')),
              matching: find.byType(SizedBox),
            )
            .first,
      ),
      const Size(58, 58),
    );
  });

  testWidgets('POI clusters retain the pin silhouette and show count', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(child: buildGpsPinClusterMarker(count: 27)),
        ),
      ),
    );

    expect(
      find.byKey(const ValueKey<String>('poi-cluster-pin-shape')),
      findsOneWidget,
    );
    expect(find.text('27'), findsOneWidget);
  });

  testWidgets('POI pin family remains visually stable', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 112));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          backgroundColor: const Color(0xFFE8EEF2),
          body: RepaintBoundary(
            key: const ValueKey<String>('poi-pin-preview'),
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  buildGpsPinMarker(
                    pinColor: const Color(0xFF1489C7),
                    fallbackIcon: Icons.local_gas_station,
                  ),
                  const SizedBox(width: 10),
                  buildGpsPinMarker(
                    pinColor: const Color(0xFF049A8F),
                    fallbackIcon: Icons.scale,
                  ),
                  const SizedBox(width: 10),
                  buildGpsPinMarker(
                    pinColor: const Color(0xFF34495E),
                    fallbackIcon: Icons.build,
                  ),
                  const SizedBox(width: 10),
                  buildGpsPinClusterMarker(count: 27),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    await expectLater(
      find.byKey(const ValueKey<String>('poi-pin-preview')),
      matchesGoldenFile('goldens/poi_markers.png'),
    );
  });
}
