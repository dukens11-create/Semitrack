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
class PoiItem {
  final String id;
  final String name;
  final String category;
  final String icon;
  final double lat;
  final double lng;
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
    this.country = '',
    this.stateOrProvince = '',
    this.city = '',
    this.exitNumber,
  });

  factory PoiItem.fromJson(Map<String, dynamic> json) {
    return PoiItem(
      id: json['id'] as String,
      name: json['name'] as String,
      category: json['category'] as String,
      icon: json['icon'] as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
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
