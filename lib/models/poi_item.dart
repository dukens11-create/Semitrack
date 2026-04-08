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
/// ## Entrance coordinates and verification
///
/// [entranceLat] and [entranceLng] are **optional** fields that capture the
/// precise GPS coordinate of the facility's primary truck entrance or access
/// point.  They must be paired with [verified] = `true` to take effect.
///
/// [verified] indicates whether the entrance coordinates have been confirmed
/// against a real road / satellite imagery.  When `true` and both
/// [entranceLat] and [entranceLng] are present, [displayLat]/[displayLng]
/// return those precise entrance coordinates and the map shows a **verified**
/// marker.  Otherwise [displayLat]/[displayLng] fall back to the property-
/// centre [lat]/[lng] and the map shows an **approximate** marker.
///
/// ### JSON schema example
///
/// ```json
/// // Fully verified — entrance coordinates used for map placement:
/// {
///   "type": "truck_stop",
///   "lat": 41.8795,
///   "lng": -87.6244,
///   "entrance_lat": 41.8801,
///   "entrance_lng": -87.6239,
///   "verified": true
/// }
///
/// // Approximate — primary lat/lng used, approximate marker shown:
/// {
///   "type": "truck_stop",
///   "lat": 41.8795,
///   "lng": -87.6244,
///   "verified": false
/// }
/// ```
class PoiItem {
  final String id;
  final String name;
  final String category;
  final String icon;
  final double lat;
  final double lng;

  /// Precise latitude of the primary truck entrance / access point.
  ///
  /// Optional.  Only used for map placement when [verified] is `true` and
  /// [entranceLng] is also set.  Sourced from the optional `entrance_lat`
  /// field in `locations.json`.
  final double? entranceLat;

  /// Precise longitude of the primary truck entrance / access point.
  ///
  /// Optional.  Only used for map placement when [verified] is `true` and
  /// [entranceLat] is also set.  Sourced from the optional `entrance_lng`
  /// field in `locations.json`.
  final double? entranceLng;

  /// Whether the entrance coordinates ([entranceLat]/[entranceLng]) have been
  /// verified against a real road or satellite imagery.
  ///
  /// When `true` and both entrance coordinates are present, [displayLat] and
  /// [displayLng] return those precise entrance values and the map renders a
  /// **verified** marker at the truck entrance.
  ///
  /// When `false` (or entrance coordinates are absent), [displayLat] and
  /// [displayLng] fall back to [lat]/[lng] (the property centre) and the map
  /// renders an **approximate** marker.
  ///
  /// Defaults to `false`.  Set to `true` in `locations.json` only after
  /// confirming the entrance coordinates against ground-truth data.
  final bool verified;

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
    this.verified = false,
    this.country = '',
    this.stateOrProvince = '',
    this.city = '',
    this.exitNumber,
  });

  /// Best-available display latitude.
  ///
  /// Returns [entranceLat] when [verified] is `true` and both entrance
  /// coordinates are set (precise truck-entrance GPS fix), falling back to
  /// [lat] (property centre) otherwise.
  double get displayLat =>
      (verified && entranceLat != null && entranceLng != null)
          ? entranceLat!
          : lat;

  /// Best-available display longitude.
  ///
  /// Returns [entranceLng] when [verified] is `true` and both entrance
  /// coordinates are set (precise truck-entrance GPS fix), falling back to
  /// [lng] (property centre) otherwise.
  double get displayLng =>
      (verified && entranceLat != null && entranceLng != null)
          ? entranceLng!
          : lng;

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
      verified: (json['verified'] as bool?) ?? false,
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
