import 'dart:convert';
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  const ApiException(this.statusCode, this.code, this.message);
  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => message;
}

typedef SessionReader =
    Future<({String? accessToken, String? refreshToken})> Function();
typedef SessionWriter =
    Future<void> Function(String accessToken, String refreshToken);
typedef SessionClearer = Future<void> Function();

class ApiClient {
  ApiClient({
    http.Client? httpClient,
    SessionReader? readSession,
    SessionWriter? writeSession,
    SessionClearer? clearSession,
    String? apiBaseUrl,
    Duration? requestTimeout,
  }) : _http = httpClient ?? http.Client(),
       _readSession = readSession,
       _writeSession = writeSession,
       _clearSession = clearSession,
       _baseUrl = (apiBaseUrl ?? baseUrl).replaceFirst(RegExp(r'/$'), ''),
       _requestTimeout = requestTimeout ?? const Duration(seconds: 20);

  static const baseUrl = String.fromEnvironment(
    'SEMITRACK_API_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
  final http.Client _http;
  final SessionReader? _readSession;
  final SessionWriter? _writeSession;
  final SessionClearer? _clearSession;
  final String _baseUrl;
  final Duration _requestTimeout;
  Future<bool>? _refreshInFlight;
  bool _closed = false;

  Future<Map<String, dynamic>> getJson(String path) => _request('GET', path);
  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body,
  ) => _request('POST', path, body: body);
  Future<Map<String, dynamic>> putJson(
    String path,
    Map<String, dynamic> body,
  ) => _request('PUT', path, body: body);
  Future<Map<String, dynamic>> patchJson(
    String path,
    Map<String, dynamic> body,
  ) => _request('PATCH', path, body: body);
  Future<void> delete(String path) async => _request('DELETE', path);

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool retryAfterRefresh = true,
  }) async {
    if (_closed) {
      throw const ApiException(
        0,
        'CLIENT_CLOSED',
        'This connection is no longer available.',
      );
    }
    if (!path.startsWith('/')) {
      throw const ApiException(
        0,
        'INVALID_PATH',
        'The requested API path is invalid.',
      );
    }
    final session = await _safeReadSession();
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (session.accessToken != null) {
      headers['Authorization'] = 'Bearer ${session.accessToken}';
    }
    final Uri uri;
    try {
      uri = Uri.parse('$_baseUrl$path');
    } on FormatException {
      throw const ApiException(
        0,
        'INVALID_API_URL',
        'SemiTrax is not configured with a valid server address.',
      );
    }
    final response = await _send(method, uri, headers, body);
    if (response.statusCode == 401 &&
        retryAfterRefresh &&
        session.refreshToken != null &&
        path != '/auth/refresh') {
      final refreshed = await _refresh();
      if (refreshed) {
        return _request(method, path, body: body, retryAfterRefresh: false);
      }
    }
    if (response.statusCode == 204 || response.body.isEmpty) return const {};
    final Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw ApiException(
        response.statusCode,
        'INVALID_RESPONSE',
        response.statusCode >= 200 && response.statusCode < 300
            ? 'SemiTrax received an invalid server response. Please try again.'
            : 'The server could not complete this request.',
      );
    }
    final json = decoded is Map<String, dynamic>
        ? decoded
        : <String, dynamic>{'data': decoded};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = json['error'];
      if (error is Map<String, dynamic>) {
        throw ApiException(
          response.statusCode,
          error['code']?.toString() ?? 'API_ERROR',
          error['message']?.toString() ?? 'Request failed',
        );
      }
      throw ApiException(
        response.statusCode,
        'API_ERROR',
        error?.toString() ?? 'Request failed',
      );
    }
    return json;
  }

  Future<http.Response> _send(
    String method,
    Uri uri,
    Map<String, String> headers,
    Map<String, dynamic>? body,
  ) async {
    try {
      final encodedBody = body == null ? null : jsonEncode(body);
      return await switch (method) {
        'POST' =>
          _http
              .post(uri, headers: headers, body: encodedBody)
              .timeout(_requestTimeout),
        'PUT' =>
          _http
              .put(uri, headers: headers, body: encodedBody)
              .timeout(_requestTimeout),
        'PATCH' =>
          _http
              .patch(uri, headers: headers, body: encodedBody)
              .timeout(_requestTimeout),
        'DELETE' =>
          _http.delete(uri, headers: headers).timeout(_requestTimeout),
        _ => _http.get(uri, headers: headers).timeout(_requestTimeout),
      };
    } on TimeoutException {
      throw const ApiException(
        0,
        'REQUEST_TIMEOUT',
        'The SemiTrax server took too long to respond. Please try again.',
      );
    } on SocketException {
      throw const ApiException(
        0,
        'CONNECTION_FAILED',
        'Unable to reach SemiTrax. Check your connection and try again.',
      );
    } on http.ClientException {
      throw const ApiException(
        0,
        'CONNECTION_FAILED',
        'Unable to reach SemiTrax. Check your connection and try again.',
      );
    }
  }

  Future<({String? accessToken, String? refreshToken})>
  _safeReadSession() async {
    try {
      return await _readSession?.call() ??
          (accessToken: null, refreshToken: null);
    } catch (_) {
      // A damaged/locked secure-storage entry must not block public endpoints.
      return (accessToken: null, refreshToken: null);
    }
  }

  Future<bool> _refresh() {
    return _refreshInFlight ??= _performRefresh().whenComplete(
      () => _refreshInFlight = null,
    );
  }

  Future<bool> _performRefresh() async {
    final session = await _safeReadSession();
    if (session.refreshToken == null || _writeSession == null) return false;
    try {
      final response = await _http
          .post(
            Uri.parse('$_baseUrl/auth/refresh'),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({'refreshToken': session.refreshToken}),
          )
          .timeout(_requestTimeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await _clearSession?.call();
        return false;
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) return false;
      final accessToken = decoded['accessToken'];
      final refreshToken = decoded['refreshToken'];
      if (accessToken is! String ||
          accessToken.isEmpty ||
          refreshToken is! String ||
          refreshToken.isEmpty) {
        return false;
      }
      await _writeSession(accessToken, refreshToken);
      return true;
    } catch (_) {
      return false;
    }
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _http.close();
  }
}
