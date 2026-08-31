import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/core/api_client.dart';
import 'package:semitrack_mobile/services/auth_service.dart';

void main() {
  test('account parser rejects a response without identity fields', () {
    expect(
      () => AuthUser.fromJson(const {'role': 'DRIVER'}),
      throwsA(isA<FormatException>()),
    );
  });

  test('account parser safely defaults optional server fields', () {
    final user = AuthUser.fromJson(const {
      'id': 'driver-1',
      'email': 'driver@example.com',
      'fullName': '',
    });

    expect(user.fullName, 'driver@example.com');
    expect(user.role, 'DRIVER');
    expect(user.plan, 'FREE');
  });

  test('authentication never exposes internal server errors', () {
    final message = authenticationErrorMessage(
      const ApiException(
        500,
        'INTERNAL_ERROR',
        'Invalid prisma.user.findUnique invocation',
      ),
    );

    expect(
      message,
      'SemiTraX account services are temporarily unavailable. Please try again shortly.',
    );
  });

  test('authentication preserves actionable client errors', () {
    final message = authenticationErrorMessage(
      const ApiException(401, 'INVALID_CREDENTIALS', 'Invalid credentials'),
    );

    expect(message, 'Invalid credentials');
  });
}
