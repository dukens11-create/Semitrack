import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/api_client.dart';

enum AuthStatus { loading, signedOut, signedIn }

class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.plan,
  });

  final String id;
  final String email;
  final String fullName;
  final String role;
  final String plan;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    String requiredString(String key) {
      final value = json[key];
      if (value is! String || value.trim().isEmpty) {
        throw FormatException('Missing account field: $key');
      }
      return value.trim();
    }

    final email = requiredString('email');
    return AuthUser(
      id: requiredString('id'),
      email: email,
      fullName: switch (json['fullName']) {
        final String value when value.trim().isNotEmpty => value.trim(),
        _ => email,
      },
      role: json['role'] is String ? json['role'] as String : 'DRIVER',
      plan: json['plan'] is String ? json['plan'] as String : 'FREE',
    );
  }
}

class AuthService extends ChangeNotifier {
  AuthService({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage() {
    api = ApiClient(
      readSession: _readSession,
      writeSession: _writeSession,
      clearSession: _clearSession,
    );
  }

  static const _accessKey = 'semitrack.access_token';
  static const _refreshKey = 'semitrack.refresh_token';

  final FlutterSecureStorage _storage;
  late final ApiClient api;
  AuthStatus status = AuthStatus.loading;
  AuthUser? user;
  String? errorMessage;
  bool _disposed = false;
  int _operationGeneration = 0;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<({String? accessToken, String? refreshToken})> _readSession() async =>
      (
        accessToken: await _storage.read(key: _accessKey),
        refreshToken: await _storage.read(key: _refreshKey),
      );

  Future<void> _writeSession(String accessToken, String refreshToken) async {
    await Future.wait([
      _storage.write(key: _accessKey, value: accessToken),
      _storage.write(key: _refreshKey, value: refreshToken),
    ]);
  }

  Future<void> _clearSession() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
    ]);
  }

  Future<void> restoreSession() async {
    final generation = ++_operationGeneration;
    status = AuthStatus.loading;
    _notify();
    final session = await _safeReadSession();
    if (!_isCurrent(generation)) return;
    if (session.refreshToken == null) {
      status = AuthStatus.signedOut;
      _notify();
      return;
    }
    try {
      user = AuthUser.fromJson(await api.getJson('/me'));
      status = AuthStatus.signedIn;
    } catch (_) {
      await _bestEffortClearSession();
      if (!_isCurrent(generation)) return;
      user = null;
      status = AuthStatus.signedOut;
    }
    if (_isCurrent(generation)) _notify();
  }

  Future<bool> login(String email, String password) => _authenticate(
    '/auth/login',
    {'email': email.trim(), 'password': password},
  );

  Future<bool> register(String fullName, String email, String password) =>
      _authenticate('/auth/register', {
        'fullName': fullName.trim(),
        'email': email.trim(),
        'password': password,
      });

  Future<bool> _authenticate(String path, Map<String, dynamic> body) async {
    final generation = ++_operationGeneration;
    errorMessage = null;
    _notify();
    try {
      final json = await api.postJson(path, body);
      if (!_isCurrent(generation)) return false;
      final accessToken = json['accessToken'];
      final refreshToken = json['refreshToken'];
      final rawUser = json['user'];
      if (accessToken is! String ||
          accessToken.isEmpty ||
          refreshToken is! String ||
          refreshToken.isEmpty ||
          rawUser is! Map) {
        throw const FormatException('Invalid authentication response');
      }
      await _writeSession(accessToken, refreshToken);
      if (!_isCurrent(generation)) return false;
      user = AuthUser.fromJson(Map<String, dynamic>.from(rawUser));
      status = AuthStatus.signedIn;
      _notify();
      return true;
    } on ApiException catch (error) {
      errorMessage = error.message;
    } catch (_) {
      errorMessage =
          'Unable to connect to SemiTrax. Check your connection and try again.';
    }
    if (_isCurrent(generation)) _notify();
    return false;
  }

  Future<void> requestPasswordReset(String email) async {
    await api.postJson('/auth/password-reset/request', {'email': email.trim()});
  }

  Future<void> logout() async {
    final generation = ++_operationGeneration;
    final session = await _safeReadSession();
    try {
      await api.postJson('/auth/logout', {
        'refreshToken': session.refreshToken,
      });
    } catch (_) {
      // Local logout must still succeed if the network is unavailable.
    }
    await _bestEffortClearSession();
    if (!_isCurrent(generation)) return;
    user = null;
    status = AuthStatus.signedOut;
    errorMessage = null;
    _notify();
  }

  bool _isCurrent(int generation) =>
      !_disposed && generation == _operationGeneration;

  Future<({String? accessToken, String? refreshToken})>
  _safeReadSession() async {
    try {
      return await _readSession();
    } catch (_) {
      await _bestEffortClearSession();
      return (accessToken: null, refreshToken: null);
    }
  }

  Future<void> _bestEffortClearSession() async {
    try {
      await _clearSession();
    } catch (_) {
      // An unavailable platform keystore must never trap the user in-session.
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _operationGeneration++;
    api.close();
    super.dispose();
  }
}
