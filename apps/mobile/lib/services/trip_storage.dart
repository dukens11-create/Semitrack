import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/trip.dart';

/// Persists and retrieves completed trips using [SharedPreferences].
class TripStorage {
  static const _key = 'trip_history';

  /// Returns all saved trips, newest first (sorted by [Trip.completedAt] descending).
  static Future<List<Trip>> loadTrips() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return [];
    final List<dynamic> decoded = jsonDecode(raw) as List<dynamic>;
    final trips = decoded
        .map((e) => Trip.fromJson(e as Map<String, dynamic>))
        .toList();
    trips.sort((a, b) => b.completedAt.compareTo(a.completedAt));
    return trips;
  }

  /// Saves [trip] to persistent storage, inserting it at the front of the
  /// list so that the most recently completed trip appears first.
  static Future<void> saveTrip(Trip trip) async {
    final prefs = await SharedPreferences.getInstance();
    final trips = await loadTrips();
    trips.insert(0, trip);
    await prefs.setString(
      _key,
      jsonEncode(trips.map((e) => e.toJson()).toList()),
    );
  }

  /// Removes the trip with the given [id] from storage.
  static Future<void> deleteTrip(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final trips = await loadTrips();
    trips.removeWhere((t) => t.id == id);
    await prefs.setString(
      _key,
      jsonEncode(trips.map((e) => e.toJson()).toList()),
    );
  }
}
