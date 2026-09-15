import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/core/api_client.dart';

void main() {
  test('development API URL remains available outside release builds', () {
    expect(
      validateSemiTrackApiUrl('http://10.0.2.2:4000/', releaseMode: false),
      'http://10.0.2.2:4000',
    );
  });

  test('release rejects local and non-HTTPS API URLs', () {
    for (final value in const [
      'http://10.0.2.2:4000',
      'https://localhost:4000',
      'https://127.0.0.1:4000',
      'http://api.semitrax.com',
    ]) {
      expect(
        () => validateSemiTrackApiUrl(value, releaseMode: true),
        throwsStateError,
      );
    }
  });

  test('release accepts explicit HTTPS production API URL', () {
    expect(
      validateSemiTrackApiUrl('https://api.semitrax.com/', releaseMode: true),
      'https://api.semitrax.com',
    );
  });
}
