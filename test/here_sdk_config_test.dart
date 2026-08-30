import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/config/here_sdk_config.dart';

void main() {
  test(
    'loads official HERE properties without hard-coded credentials',
    () {
      expect(HereSdkConfig.isConfigured, isTrue);
      expect(() => HereSdkConfig.validate(), returnsNormally);
    },
    skip: HereSdkConfig.isConfigured
        ? false
        : 'Run with --dart-define-from-file=config/here/credentials.properties',
  );
}
