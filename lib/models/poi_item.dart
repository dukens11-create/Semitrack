import 'dart:convert';

/// A point of interest (POI) entry from `assets/locations.json`.
///
/// [icon] is the Mapbox image ID registered in the map style via
/// [registerPoiIcons].  It corresponds to a PNG file under
/// `assets/logo_brand_markers/` after filename normalisation (spaces replaced
/// with underscores, lowercase, no extension).
///
/// The required fields are [id], [name], [icon], [lat], [lng], and [category].
/// The optional fields [country], [stateOrProvince], [city], and [exitNumber]
/// default to an empty string / null when absent from the JSON.
///
/// For maximum map accuracy, the optional [entranceLat] and [entranceLng]
/// fields capture the precise GPS coordinate of the facility's primary truck
/// entrance or access point.  When present they should be preferred over [lat]
/// and [lng] (which represent the approximate centre of the property) so that
/// markers are placed at the true entry point drivers approach on the road.
/// Use [displayLat] and [displayLng] to obtain the best-available coordinate
/// automatically.
class PoiItem {
  final String id;
  final String name;
  final String category;
  final String icon;
  final double lat;
  final double lng;

  /// Precise latitude of the primary truck entrance / access point.
  ///
  /// When present, this is more accurate than [lat] (the property centre) and
  /// should be used for map marker placement.  Sourced from the optional
  /// `entrance_lat` field in `locations.json`.
  final double? entranceLat;

  /// Precise longitude of the primary truck entrance / access point.
  ///
  /// When present, this is more accurate than [lng] (the property centre) and
  /// should be used for map marker placement.  Sourced from the optional
  /// `entrance_lng` field in `locations.json`.
  final double? entranceLng;

  final String country;
  final String stateOrProvince;
  final String city;
  /// Highway exit number nearest to this stop (e.g. "309", "13A").
  /// Sourced from the optional `exit_number` field in `locations.json`.
  final String? exitNumber;

  const PoiItem({
    required this.id,
    required this.name,
    required this.category,
    required this.icon,
    required this.lat,
    required this.lng,
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

  factory PoiItem.fromJson(Map<String, dynamic> json) {
    return PoiItem(
      id: json['id'] as String,
      name: json['name'] as String,
      category: json['category'] as String,
      icon: json['icon'] as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      entranceLat: json['entrance_lat'] != null
          ? (json['entrance_lat'] as num).toDouble()
          : null,
      entranceLng: json['entrance_lng'] != null
          ? (json['entrance_lng'] as num).toDouble()
          : null,
      country: (json['country'] as String?) ?? '',
      stateOrProvince: (json['stateOrProvince'] as String?) ?? '',
      city: (json['city'] as String?) ?? '',
      exitNumber: json['exit_number'] as String?,
    );
  }

  static List<PoiItem> listFromJson(String jsonString) {
    final List<dynamic> data = jsonDecode(jsonString) as List<dynamic>;
    return data
        .map((e) => PoiItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
