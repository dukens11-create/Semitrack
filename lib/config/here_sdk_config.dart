class HereSdkConfig {
  const HereSdkConfig._();

  // The primary names match HERE's downloaded credentials.properties file so
  // Flutter can consume it directly with --dart-define-from-file. The legacy
  // uppercase names remain supported for CI secret injection.
  static const accessKeyId = String.fromEnvironment(
    'here.access.key.id',
    defaultValue: String.fromEnvironment('HERE_ACCESS_KEY_ID'),
  );
  static const accessKeySecret = String.fromEnvironment(
    'here.access.key.secret',
    defaultValue: String.fromEnvironment('HERE_ACCESS_KEY_SECRET'),
  );

  static bool get isConfigured =>
      accessKeyId.trim().isNotEmpty && accessKeySecret.trim().isNotEmpty;

  static void validate() {
    if (!isConfigured) {
      throw const HereSdkConfigurationException(
        'HERE Explore credentials are not configured. Supply '
        'config/here/credentials.properties with '
        '--dart-define-from-file, or inject HERE_ACCESS_KEY_ID and '
        'HERE_ACCESS_KEY_SECRET through the secure CI build environment.',
      );
    }
  }
}

class HereSdkConfigurationException implements Exception {
  const HereSdkConfigurationException(this.message);
  final String message;

  @override
  String toString() => message;
}
