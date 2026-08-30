import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/street_guidance.dart';

void main() {
  group('buildStreetGuidanceText', () {
    test('formats the current and incoming streets as a two-line header', () {
      final guidance = buildStreetGuidanceText(
        maneuverType: 'depart',
        modifier: 'east',
        instruction: 'Head east on Allegrini Dr toward Hubble Dr',
        roadName: 'Allegrini Dr',
        nextRoadName: 'Hubble Dr',
      );

      expect(guidance.actionText, 'Head E on');
      expect(guidance.roadName, 'Allegrini Dr');
      expect(guidance.towardRoadName, 'Hubble Dr');
      expect(guidance.headline, 'Head E on Allegrini Dr');
      expect(guidance.towardLine, 'toward Hubble Dr');
    });

    test('formats a named turn and its following road', () {
      final guidance = buildStreetGuidanceText(
        maneuverType: 'turn',
        modifier: 'left',
        instruction: 'Turn left onto Hubble Drive',
        roadName: 'Hubble Drive',
        nextRoadName: 'Vista Boulevard',
      );

      expect(guidance.headline, 'Turn left onto Hubble Drive');
      expect(guidance.towardLine, 'toward Vista Boulevard');
    });

    test('does not repeat equivalent abbreviated road names', () {
      final guidance = buildStreetGuidanceText(
        maneuverType: 'continue',
        modifier: 'straight',
        instruction: 'Continue on Hubble Drive',
        roadName: 'Hubble Drive',
        nextRoadName: 'Hubble Dr',
      );

      expect(guidance.headline, 'Continue on Hubble Drive');
      expect(guidance.towardLine, isNull);
    });

    test('uses provider next road when instruction omits toward', () {
      final guidance = buildStreetGuidanceText(
        maneuverType: 'depart',
        modifier: 'northbound',
        instruction: 'Head north on US-395',
        roadName: 'US-395',
        nextRoadName: 'I-80 W',
      );

      expect(guidance.headline, 'Head N on US-395');
      expect(guidance.towardLine, 'toward I-80 W');
    });
  });
}
