import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:semitrack_mobile/core/api_client.dart';

/// Best-effort, privacy-preserving product analytics.
///
/// Events are accepted only by the authenticated SemiTraX API. This service
/// deliberately has no latitude/longitude fields: operational dashboards use
/// aggregate activity and never receive a driver's precise live position.
class AnalyticsService {
  AnalyticsService(this._api);

  final ApiClient _api;
  final Random _random = Random.secure();
  Timer? _heartbeatTimer;
  String? _serverSessionId;
  int? _estimatedDriveMinutes;
  double? _actualDistanceMiles;
  int? _actualDurationSeconds;
  bool _hosWarningShown = false;

  Future<void> recordEvent(
    String eventType, {
    String? entityId,
    String? stateRegion,
    double? numericValue,
    int? durationSeconds,
    String? label,
  }) async {
    final body = <String, dynamic>{
      'clientEventId': _uuidV4(),
      'eventType': eventType,
      if (entityId != null && entityId.trim().isNotEmpty)
        'entityId': entityId.trim(),
      if (stateRegion != null && stateRegion.trim().isNotEmpty)
        'stateRegion': stateRegion.trim(),
      if (numericValue != null) 'numericValue': numericValue,
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
      if (label != null && label.trim().isNotEmpty)
        'metadata': <String, String>{'label': label.trim()},
    };
    await _bestEffort(() => _api.postJson('/analytics/events', body));
  }

  Future<void> startNavigation({
    int? estimatedDriveMinutes,
    String? stateRegion,
  }) async {
    await endNavigation(status: 'CANCELED');
    _estimatedDriveMinutes = estimatedDriveMinutes;
    _actualDistanceMiles = 0;
    _actualDurationSeconds = 0;
    _hosWarningShown = false;

    try {
      final response = await _api.postJson('/analytics/navigation-sessions', {
        'clientSessionId': _uuidV4(),
        if (estimatedDriveMinutes != null)
          'estimatedDriveMinutes': estimatedDriveMinutes,
        if (stateRegion != null && stateRegion.trim().isNotEmpty)
          'stateRegion': stateRegion.trim(),
      });
      final id = response['id']?.toString();
      if (id == null || id.isEmpty) return;
      _serverSessionId = id;
      _heartbeatTimer = Timer.periodic(
        const Duration(minutes: 1),
        (_) => unawaited(_sendHeartbeat()),
      );
    } catch (error) {
      _reportBestEffortFailure(error);
    }
  }

  void updateNavigationSnapshot({
    int? estimatedDriveMinutes,
    double? actualDistanceMiles,
    int? actualDurationSeconds,
    bool? hosWarningShown,
  }) {
    if (estimatedDriveMinutes != null) {
      _estimatedDriveMinutes = estimatedDriveMinutes;
    }
    if (actualDistanceMiles != null && actualDistanceMiles >= 0) {
      _actualDistanceMiles = actualDistanceMiles;
    }
    if (actualDurationSeconds != null && actualDurationSeconds >= 0) {
      _actualDurationSeconds = actualDurationSeconds;
    }
    if (hosWarningShown == true) _hosWarningShown = true;
  }

  Future<void> endNavigation({required String status}) async {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    final id = _serverSessionId;
    _serverSessionId = null;
    if (id == null) return;
    await _bestEffort(
      () => _api.postJson('/analytics/navigation-sessions/$id/end', {
        'status': status,
        if (_estimatedDriveMinutes != null)
          'estimatedDriveMinutes': _estimatedDriveMinutes,
        if (_actualDistanceMiles != null)
          'actualDistanceMiles': _actualDistanceMiles,
        if (_actualDurationSeconds != null)
          'actualDurationSeconds': _actualDurationSeconds,
        if (_hosWarningShown) 'hosWarningShown': true,
      }),
    );
  }

  Future<void> _sendHeartbeat() async {
    final id = _serverSessionId;
    if (id == null) return;
    await _bestEffort(
      () => _api.postJson('/analytics/navigation-sessions/$id/heartbeat', {
        if (_estimatedDriveMinutes != null)
          'estimatedDriveMinutes': _estimatedDriveMinutes,
        if (_actualDistanceMiles != null)
          'actualDistanceMiles': _actualDistanceMiles,
        if (_actualDurationSeconds != null)
          'actualDurationSeconds': _actualDurationSeconds,
        if (_hosWarningShown) 'hosWarningShown': true,
      }),
    );
  }

  Future<void> _bestEffort(
    Future<Map<String, dynamic>> Function() operation,
  ) async {
    try {
      await operation();
    } catch (error) {
      _reportBestEffortFailure(error);
    }
  }

  void _reportBestEffortFailure(Object error) {
    if (kDebugMode) {
      debugPrint('Analytics delivery unavailable (${error.runtimeType}).');
    }
  }

  String _uuidV4() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String pair(int value) => value.toRadixString(16).padLeft(2, '0');
    final hex = bytes.map(pair).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }

  void dispose() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }
}
