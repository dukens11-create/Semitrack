import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('removed vendor is absent from Android build and runtime sources', () {
    const removedVendor = 'tom' 'tom';
    final roots = <Directory>[
      Directory('android'),
      Directory('.github/workflows'),
    ];
    final files = roots
        .expand((root) => root.listSync(recursive: true).whereType<File>())
        .where(
          (file) => const {
            '.gradle',
            '.kt',
            '.kts',
            '.xml',
            '.yaml',
            '.yml',
          }.contains(_extension(file.path)),
        );

    final references = <String>[];
    for (final file in files) {
      if (file.readAsStringSync().toLowerCase().contains(removedVendor)) {
        references.add(file.path);
      }
    }

    expect(references, isEmpty);
  });

  test(
    'native guidance remains fail-closed while Trimble remains authoritative',
    () {
      final engine = File(
        'android/app/src/main/kotlin/com/example/semitrack_mobile/navigation/'
        'NativeGuidanceEngine.kt',
      ).readAsStringSync();
      final policy = File(
        'android/app/src/main/kotlin/com/example/semitrack_mobile/navigation/'
        'GuidanceSafetyPolicy.kt',
      ).readAsStringSync();

      expect(engine, contains('TruckSafeGuidanceUnavailableEngine'));
      expect(engine, contains('TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE'));
      expect(policy, contains('TRIMBLE_ROUTE_REQUIRED'));
      expect(policy, contains('TRIMBLE_ROUTE_GEOMETRY_REQUIRED'));
    },
  );
}

String _extension(String path) {
  final name = path.replaceAll('\\', '/').split('/').last;
  final dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.substring(dot);
}
