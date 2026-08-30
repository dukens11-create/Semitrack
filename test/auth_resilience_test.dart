import 'package:flutter_test/flutter_test.dart';
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
}
