import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/utils/navigation_utils.dart';

void main() {
  test('normalizeBearing always returns a 0 to 360 degree heading', () {
    expect(normalizeBearing(-10), closeTo(350, 0.0001));
    expect(normalizeBearing(370), closeTo(10, 0.0001));
    expect(normalizeBearing(720), closeTo(0, 0.0001));
  });

  test('interpolateBearing crosses north using the shortest path', () {
    expect(interpolateBearing(350, 10, 0.5), closeTo(0, 0.0001));
    expect(interpolateBearing(10, 350, 0.5), closeTo(0, 0.0001));
  });

  test('smoothBearing accepts a small wrap-around change', () {
    expect(smoothBearing(10, 350), closeTo(10, 0.0001));
  });
}
