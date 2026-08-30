import 'dart:async';

import 'package:here_sdk/core.dart';
import 'package:here_sdk/core.engine.dart';
import 'package:here_sdk/core.errors.dart';
import 'package:here_sdk/core.threading.dart';
import 'package:here_sdk/search.dart';

import '../config/here_sdk_config.dart';

enum HereSdkCredentialStatus { verified, rejected, networkUnavailable }

class HereSdkService {
  HereSdkService._();

  static final HereSdkService instance = HereSdkService._();

  bool _initialized = false;
  SearchEngine? _searchEngine;
  TaskHandle? _credentialVerificationTask;
  HereSdkCredentialStatus? _credentialStatus;

  bool get isInitialized => _initialized;
  HereSdkCredentialStatus? get credentialStatus => _credentialStatus;
  bool get isAuthorized =>
      _credentialStatus == HereSdkCredentialStatus.verified;

  Future<void> initialize() async {
    if (_initialized) return;
    HereSdkConfig.validate();

    SdkContext.init(IsolateOrigin.main);
    final authenticationMode = AuthenticationMode.withKeySecret(
      HereSdkConfig.accessKeyId,
      HereSdkConfig.accessKeySecret,
    );
    final options = SDKOptions.withAuthenticationMode(authenticationMode);

    try {
      await SDKNativeEngine.makeSharedInstance(options);
      _searchEngine = SearchEngine();
      _initialized = true;
    } on InstantiationException catch (error) {
      SdkContext.release();
      throw HereSdkInitializationException(error.error.name);
    } catch (_) {
      SdkContext.release();
      rethrow;
    }
  }

  /// Uses a fixed public coordinate to make a minimal online Search request.
  /// HERE documents that native-engine creation alone does not prove that the
  /// credential is valid; a feature-engine request is required.
  Future<HereSdkCredentialStatus> verifyCredentials({
    Duration timeout = const Duration(seconds: 12),
  }) async {
    if (!_initialized || _searchEngine == null) {
      throw StateError('HERE SDK must be initialized before verification.');
    }

    final completer = Completer<HereSdkCredentialStatus>();
    final options = SearchOptions()..maxItems = 1;
    _credentialVerificationTask = _searchEngine!.searchByCoordinates(
      GeoCoordinates(45.5152, -122.6784),
      options,
      (error, _) {
        _credentialVerificationTask = null;
        if (completer.isCompleted) return;
        if (error == null || error == SearchError.noResultsFound) {
          completer.complete(HereSdkCredentialStatus.verified);
        } else if (error == SearchError.authenticationFailed ||
            error == SearchError.forbidden) {
          completer.complete(HereSdkCredentialStatus.rejected);
        } else {
          completer.complete(HereSdkCredentialStatus.networkUnavailable);
        }
      },
    );

    try {
      final status = await completer.future.timeout(timeout);
      _credentialStatus = status;
      return status;
    } on TimeoutException {
      _credentialVerificationTask?.cancel();
      _credentialVerificationTask = null;
      _credentialStatus = HereSdkCredentialStatus.networkUnavailable;
      return _credentialStatus!;
    }
  }

  Future<void> dispose() async {
    _credentialVerificationTask?.cancel();
    _credentialVerificationTask = null;
    _searchEngine = null;
    _credentialStatus = null;
    if (!_initialized) return;
    await SDKNativeEngine.sharedInstance?.dispose();
    SDKNativeEngine.sharedInstance = null;
    SdkContext.release();
    _initialized = false;
  }
}

class HereSdkInitializationException implements Exception {
  const HereSdkInitializationException(this.errorCode);

  final String errorCode;

  @override
  String toString() => 'HERE SDK initialization failed: $errorCode';
}
