import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/navigation_state.dart';

void main() {
  test('parses native route progress and real lane guidance', () {
    final state = NativeNavigationState.fromMap({
      'phase': 'navigating',
      'remainingDistanceMeters': 1200.0,
      'remainingDurationSeconds': 90.0,
      'currentManeuver': {
        'instruction': 'Keep left',
        'type': 'fork',
        'distanceMeters': 150.0,
        'lanes': [
          {
            'directions': ['straight', 'left'],
            'recommended': true,
          },
        ],
      },
    });

    expect(state.phase, NativeNavigationPhase.navigating);
    expect(state.remainingDistanceMeters, 1200);
    expect(state.currentManeuver?.instruction, 'Keep left');
    expect(state.currentManeuver?.lanes.single.recommended, isTrue);
    expect(state.currentManeuver?.lanes.single.directions, [
      'straight',
      'left',
    ]);
  });

  test('missing lane data remains empty instead of being invented', () {
    final state = NativeNavigationState.fromMap({
      'phase': 'previewing',
      'currentManeuver': {'instruction': 'Continue'},
    });

    expect(state.currentManeuver?.lanes, isEmpty);
  });

  test(
    'malformed native fields are ignored instead of crashing the stream',
    () {
      final state = NativeNavigationState.fromMap({
        'phase': 42,
        'remainingDistanceMeters': 'not-a-number',
        'roadName': 99,
        'currentManeuver': {
          'instruction': true,
          'type': null,
          'distanceMeters': double.nan,
          'lanes': 'invalid',
        },
      });

      expect(state.phase, NativeNavigationPhase.error);
      expect(state.remainingDistanceMeters, isNull);
      expect(state.roadName, '99');
      expect(state.currentManeuver?.instruction, isEmpty);
      expect(state.currentManeuver?.type, 'unknown');
      expect(state.currentManeuver?.distanceMeters, isNull);
      expect(state.currentManeuver?.lanes, isEmpty);
    },
  );
}
