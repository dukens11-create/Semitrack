typedef TelemetrySink = void Function(Map<String, Object?> event);

/// Redacted navigation telemetry. Precise coordinates, credentials, tokens and
/// proprietary provider payloads are removed by construction.
class NavigationTelemetry {
  NavigationTelemetry(this._sink);
  final TelemetrySink _sink;
  static const _blockedFragments = <String>['token','secret','password','authorization','latitude','longitude','lat','lng','coordinate','geometry','polyline','payload'];

  void record(String name, Map<String, Object?> fields) {
    final safe = <String, Object?>{'event': name, 'at': DateTime.now().toUtc().toIso8601String()};
    for (final entry in fields.entries) {
      if (_isBlocked(entry.key)) continue;
      final value = entry.value;
      if (value == null || value is num || value is bool || value is String && value.length <= 256) safe[entry.key] = value;
    }
    _sink(Map.unmodifiable(safe));
  }

  bool _isBlocked(String key) {
    final normalized = key.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    return _blockedFragments.any((fragment) => normalized.contains(fragment));
  }
}
