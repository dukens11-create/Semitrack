import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Persists only navigation intent/state needed to safely rebuild a route.
/// A recovered snapshot MUST be revalidated by the commercial truck router
/// before guidance resumes; stored geometry is never treated as authoritative.
class NavigationSessionSnapshot {
  const NavigationSessionSnapshot({
    required this.sessionId,
    required this.savedAt,
    required this.destination,
    required this.stops,
    required this.truckProfileFingerprint,
  });

  final String sessionId;
  final DateTime savedAt;
  final Map<String, dynamic> destination;
  final List<Map<String, dynamic>> stops;
  final String truckProfileFingerprint;

  Map<String, dynamic> toJson() => {
        'version': 1,
        'sessionId': sessionId,
        'savedAt': savedAt.toUtc().toIso8601String(),
        'destination': destination,
        'stops': stops,
        'truckProfileFingerprint': truckProfileFingerprint,
      };

  static NavigationSessionSnapshot? fromJson(Map<String, dynamic> json) {
    if (json['version'] != 1) return null;
    final savedAt = DateTime.tryParse(json['savedAt']?.toString() ?? '');
    final destination = json['destination'];
    final rawStops = json['stops'];
    if (savedAt == null || destination is! Map || rawStops is! List) return null;
    return NavigationSessionSnapshot(
      sessionId: json['sessionId']?.toString() ?? '',
      savedAt: savedAt,
      destination: Map<String, dynamic>.from(destination),
      stops: rawStops.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList(),
      truckProfileFingerprint: json['truckProfileFingerprint']?.toString() ?? '',
    );
  }
}

class NavigationSessionStore {
  NavigationSessionStore({this.maxAge = const Duration(hours: 12)});

  static const _key = 'navigation_session_v1';
  final Duration maxAge;

  Future<void> save(NavigationSessionSnapshot snapshot) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(snapshot.toJson()));
  }

  Future<NavigationSessionSnapshot?> loadForRevalidation({DateTime? now}) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final snapshot = NavigationSessionSnapshot.fromJson(Map<String, dynamic>.from(decoded));
      if (snapshot == null || snapshot.sessionId.isEmpty || snapshot.truckProfileFingerprint.isEmpty) return null;
      final age = (now ?? DateTime.now().toUtc()).toUtc().difference(snapshot.savedAt.toUtc());
      if (age.isNegative || age > maxAge) {
        await clear();
        return null;
      }
      return snapshot;
    } catch (_) {
      await clear();
      return null;
    }
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
