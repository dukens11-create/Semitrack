import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:semitrack_mobile/core/api_client.dart';

void main() {
  test('malformed successful JSON becomes a safe API exception', () async {
    final client = ApiClient(
      apiBaseUrl: 'https://example.test',
      httpClient: MockClient((_) async => http.Response('<html>', 200)),
    );

    await expectLater(
      client.getJson('/health'),
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'INVALID_RESPONSE')
            .having((error) => error.statusCode, 'status', 200),
      ),
    );
    client.close();
  });

  test('a stalled request times out with a driver-safe error', () async {
    final never = Completer<http.Response>();
    final client = ApiClient(
      apiBaseUrl: 'https://example.test',
      requestTimeout: const Duration(milliseconds: 5),
      httpClient: MockClient((_) => never.future),
    );

    await expectLater(
      client.getJson('/health'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'REQUEST_TIMEOUT',
        ),
      ),
    );
    client.close();
  });

  test(
    'closed client rejects work without leaking a ClientException',
    () async {
      final client = ApiClient(
        apiBaseUrl: 'https://example.test',
        httpClient: MockClient((_) async => http.Response('{}', 200)),
      )..close();

      await expectLater(
        client.getJson('/health'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'CLIENT_CLOSED',
          ),
        ),
      );
    },
  );
}
