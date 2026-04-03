import 'dart:convert';

/// A truck stop point of interest loaded from `assets/truck_stop_poi/locations.json`.
///
/// [icon] matches the PNG filename under `assets/truck_stop_poi/` (e.g.
/// `'pilot.png'`).  The full asset path used to display the marker is
/// `assets/truck_stop_poi/{icon}`.
class TruckStopPOI {
  final String name;
  final String icon;
  final double lat;
  final double lng;
  final String country;
  final String stateOrProvince;
  final String city;

  TruckStopPOI({
    required this.name,
    required this.icon,
    required this.lat,
    required this.lng,
    required this.country,
    required this.stateOrProvince,
    required this.city,
  });

  factory TruckStopPOI.fromJson(Map<String, dynamic> json) {
    return TruckStopPOI(
      name: json['name'] as String,
      icon: json['icon'] as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      country: json['country'] as String,
      stateOrProvince: json['stateOrProvince'] as String,
      city: json['city'] as String,
    );
  }

  static List<TruckStopPOI> listFromJson(String jsonString) {
    final List<dynamic> data = jsonDecode(jsonString) as List<dynamic>;
    return data
        .map((e) => TruckStopPOI.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
