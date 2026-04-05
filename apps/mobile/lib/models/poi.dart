import 'dart:convert';

import 'package:semitrack_mobile/models/poi_item.dart';

/// Unified Point of Interest model for Semitrack navigation.
///
/// Represents any navigable POI on the map — truck stops, weigh stations,
/// rest areas, etc. — under a single, consistent schema that mirrors the
/// `assets/locations.json` format and supports both USA and Canada datasets.
///
/// [type] maps directly to the `category` field in the JSON file:
///   • `"truck_stop"` — Pilot, Love's, TA, Petro, Flying J, etc.
///   • `"weigh_station"` — USDOT / provincial weigh-in-motion stations.
///   • `"rest_area"` — Interstate / highway rest areas.
///
/// [icon] is the normalised Mapbox image ID (PNG filename stem) registered via
/// `registerPoiIcons()`, e.g. `"pilot"`, `"loves"`, `"weight_station"`.
///
/// For maximum geographic precision, the optional [entranceLat] and
/// [entranceLng] fields capture the GPS coordinate of the facility's primary
/// truck entrance.  Use [displayLat] and [displayLng] to obtain the
/// best-available coordinate automatically.
class Poi {
  final String id;
  final String name;

  /// POI category — `"truck_stop"`, `"weigh_station"`, or `"rest_area"`.
  final String type;

  final double lat;
  final double lng;

  /// Precise latitude of the primary truck entrance / access point.
  ///
  /// When present this is more accurate than [lat] (the property centre) and
  /// should be used for map marker placement.
  final double? entranceLat;

  /// Precise longitude of the primary truck entrance / access point.
  ///
  /// When present this is more accurate than [lng] (the property centre) and
  /// should be used for map marker placement.
  final double? entranceLng;

  /// Mapbox image ID / asset filename stem for the brand logo marker.
  final String icon;

  /// ISO-3166-1 alpha-2 country code, e.g. `"US"` or `"CA"`.
  final String country;

  /// State, province, or territory abbreviation, e.g. `"CA"`, `"ON"`, `"BC"`.
  final String stateOrProvince;

  /// City or nearest municipality name.
  final String city;

  /// Nearest highway exit number, e.g. `"309"`, `"13A"`.
  final String? exitNumber;

  const Poi({
    required this.id,
    required this.name,
    required this.type,
    required this.lat,
    required this.lng,
    required this.icon,
    this.entranceLat,
    this.entranceLng,
    this.country = '',
    this.stateOrProvince = '',
    this.city = '',
    this.exitNumber,
  });

  /// Best-available display latitude.
  ///
  /// Returns [entranceLat] when set (precise truck-entrance GPS fix), falling
  /// back to [lat] (property centre) otherwise.
  double get displayLat => entranceLat ?? lat;

  /// Best-available display longitude.
  ///
  /// Returns [entranceLng] when set (precise truck-entrance GPS fix), falling
  /// back to [lng] (property centre) otherwise.
  double get displayLng => entranceLng ?? lng;

  /// Deserialises a single POI from a JSON map.
  ///
  /// Accepts either `"category"` (legacy) or `"type"` as the type field.
  factory Poi.fromJson(Map<String, dynamic> json) {
    return Poi(
      id: json['id'] as String,
      name: json['name'] as String,
      type: (json['type'] ?? json['category']) as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      entranceLat: json['entrance_lat'] != null
          ? (json['entrance_lat'] as num).toDouble()
          : null,
      entranceLng: json['entrance_lng'] != null
          ? (json['entrance_lng'] as num).toDouble()
          : null,
      icon: json['icon'] as String,
      country: (json['country'] as String?) ?? '',
      stateOrProvince: (json['stateOrProvince'] as String?) ?? '',
      city: (json['city'] as String?) ?? '',
      exitNumber: json['exit_number'] as String?,
    );
  }

  /// Creates a [Poi] from an existing [PoiItem], preserving all fields.
  factory Poi.fromPoiItem(PoiItem item) {
    return Poi(
      id: item.id,
      name: item.name,
      type: item.category,
      lat: item.lat,
      lng: item.lng,
      entranceLat: item.entranceLat,
      entranceLng: item.entranceLng,
      icon: item.icon,
      country: item.country,
      stateOrProvince: item.stateOrProvince,
      city: item.city,
      exitNumber: item.exitNumber,
    );
  }

  /// Deserialises a JSON array string into a list of [Poi] objects.
  static List<Poi> listFromJson(String jsonString) {
    final List<dynamic> data = jsonDecode(jsonString) as List<dynamic>;
    return data.map((e) => Poi.fromJson(e as Map<String, dynamic>)).toList();
  }
}
