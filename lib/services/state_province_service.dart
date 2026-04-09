import 'dart:convert';

import 'package:flutter/services.dart';

import 'package:semitrack_mobile/models/state_province.dart';

/// Loads the list of US states and Canadian provinces from the bundled JSON
/// asset `assets/data/states_provinces.json` (from the *welcome states pack*).
///
/// Usage:
/// ```dart
/// final states = await StateProvinceService.load();
/// final usOnly  = StateProvinceService.filterByCountry(states, 'US');
/// ```
class StateProvinceService {
  StateProvinceService._();

  static const String _assetPath = 'assets/data/states_provinces.json';

  /// Parses and returns every entry in the bundled JSON asset.
  static Future<List<StateProvince>> load() async {
    final String raw = await rootBundle.loadString(_assetPath);
    final List<dynamic> decoded = jsonDecode(raw) as List<dynamic>;
    return decoded
        .map((e) => StateProvince.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Returns only entries whose [StateProvince.country] matches [countryCode]
  /// (e.g. `'US'` or `'CA'`).
  static List<StateProvince> filterByCountry(
    List<StateProvince> all,
    String countryCode,
  ) =>
      all.where((s) => s.country == countryCode).toList();

  /// Returns the [StateProvince] with the given two-letter [code], or `null`.
  static StateProvince? findByCode(List<StateProvince> all, String code) {
    final upper = code.toUpperCase();
    try {
      return all.firstWhere((s) => s.code == upper);
    } catch (_) {
      return null;
    }
  }
}
