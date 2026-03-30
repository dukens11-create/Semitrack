import 'package:latlong2/latlong.dart';

/// Types of Point of Interest (POI) relevant to truck drivers.
enum PoiType {
  /// Mandatory or optional weigh station along the route.
  weighStation,

  /// Federally-designated or state-run rest area (HOS-required stops).
  restArea,

  /// Truck-specific parking facility (overnight / HOS breaks).
  truckParking,

  /// Full-service truck stop (fuel, showers, food, parking).
  truckStop,
}

/// Extension helpers for [PoiType].
extension PoiTypeX on PoiType {
  /// Human-readable display label shown in the filter bar and details sheet.
  String get label {
    switch (this) {
      case PoiType.weighStation:
        return 'Weigh';
      case PoiType.restArea:
        return 'Rest';
      case PoiType.truckParking:
        return 'Parking';
      case PoiType.truckStop:
        return 'Truck Stop';
    }
  }

  /// Full label used inside the details bottom sheet.
  String get fullLabel {
    switch (this) {
      case PoiType.weighStation:
        return 'Weigh Station';
      case PoiType.restArea:
        return 'Rest Area';
      case PoiType.truckParking:
        return 'Truck Parking';
      case PoiType.truckStop:
        return 'Truck Stop';
    }
  }
}

/// A single Point of Interest along a truck route.
///
/// Shared model used by the map screen and any future POI list / detail views.
/// Fields are intentionally kept flat for easy JSON / REST API mapping.
class RoutePoi {
  /// Unique identifier (stable across data refreshes).
  final String id;

  /// Display name of the facility.
  final String name;

  /// Category of this POI (drives marker colour and filter chip).
  final PoiType type;

  /// Geographic position of the POI.
  final LatLng position;

  /// Short descriptive line shown below the name (e.g. address, status).
  final String? subtitle;

  /// Number of available spots, if known.  Null when not applicable or unknown.
  final int? availableSpots;

  const RoutePoi({
    required this.id,
    required this.name,
    required this.type,
    required this.position,
    this.subtitle,
    this.availableSpots,
  });
}

// ── Mock POI data for the Portland, OR → Winnemucca, NV demo route ──────────
//
// These hardcoded entries simulate a real POI data layer so the UI works
// immediately during development.  Replace with an API call to a live truck-POI
// service (e.g. TruckPark, TruckSpy, or a custom backend) for production.

/// Demo POI data placed near the default Portland → Winnemucca route.
const List<RoutePoi> mockRoutePois = [
  // ── Weigh Stations ────────────────────────────────────────────────────────
  RoutePoi(
    id: 'ws_1',
    name: 'Booth Ranch Weigh Station',
    type: PoiType.weighStation,
    position: LatLng(45.1500, -122.9800), // I-5 south of Portland
    subtitle: 'OPEN – both directions',
    availableSpots: null,
  ),
  RoutePoi(
    id: 'ws_2',
    name: 'Goshen Weigh Station',
    type: PoiType.weighStation,
    position: LatLng(43.7900, -123.3500), // I-5 south of Eugene
    subtitle: 'OPEN – southbound',
    availableSpots: null,
  ),
  RoutePoi(
    id: 'ws_3',
    name: 'Midpoint Weigh Station',
    type: PoiType.weighStation,
    position: LatLng(42.2000, -121.7800), // US-97 central Oregon
    subtitle: 'CLOSED – maintenance',
    availableSpots: null,
  ),

  // ── Rest Areas ────────────────────────────────────────────────────────────
  RoutePoi(
    id: 'ra_1',
    name: 'Willamette Rest Area',
    type: PoiType.restArea,
    position: LatLng(44.9500, -123.0200), // I-5 near Salem
    subtitle: 'Restrooms • Picnic tables',
    availableSpots: 12,
  ),
  RoutePoi(
    id: 'ra_2',
    name: 'Siskiyou Summit Rest Area',
    type: PoiType.restArea,
    position: LatLng(42.0600, -122.5500), // I-5 Oregon/California border area
    subtitle: 'Restrooms • Truck parking',
    availableSpots: 8,
  ),
  RoutePoi(
    id: 'ra_3',
    name: 'Cascade Rest Stop',
    type: PoiType.restArea,
    position: LatLng(41.9800, -121.7000), // US-97 near California border
    subtitle: 'Restrooms only',
    availableSpots: 6,
  ),

  // ── Truck Parking ─────────────────────────────────────────────────────────
  RoutePoi(
    id: 'tp_1',
    name: 'Portland Truck Parking',
    type: PoiType.truckParking,
    position: LatLng(45.4800, -122.6700), // south Portland
    subtitle: '24-hr secured lot',
    availableSpots: 30,
  ),
  RoutePoi(
    id: 'tp_2',
    name: 'Salem Overnight Truck Park',
    type: PoiType.truckParking,
    position: LatLng(44.9400, -123.0300), // near Salem
    subtitle: 'Free • No services',
    availableSpots: 15,
  ),
  RoutePoi(
    id: 'tp_3',
    name: 'Klamath Falls Truck Lot',
    type: PoiType.truckParking,
    position: LatLng(42.2250, -121.7850), // Klamath Falls area
    subtitle: 'Paid • Security on site',
    availableSpots: 20,
  ),

  // ── Truck Stops ───────────────────────────────────────────────────────────
  RoutePoi(
    id: 'ts_1',
    name: 'Pilot Travel Center – Portland',
    type: PoiType.truckStop,
    position: LatLng(45.5810, -122.5710), // NE Portland
    subtitle: 'Diesel \$4.25 • Showers • Food',
    availableSpots: 50,
  ),
  RoutePoi(
    id: 'ts_2',
    name: "Love's Travel Stop – Eugene",
    type: PoiType.truckStop,
    position: LatLng(44.0570, -123.0920), // Eugene, OR
    subtitle: 'Diesel \$4.19 • Laundry • DEF',
    availableSpots: 35,
  ),
  RoutePoi(
    id: 'ts_3',
    name: 'TA Travel Center – Redding',
    type: PoiType.truckStop,
    position: LatLng(40.5900, -122.3800), // Redding, CA (on I-5 detour)
    subtitle: 'Diesel \$4.39 • Repair • Parking',
    availableSpots: 40,
  ),
];
