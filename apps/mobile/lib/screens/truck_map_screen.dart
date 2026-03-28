import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Full-featured truck navigation screen.
///
/// Integrates a Mapbox map widget (via flutter_map), fetches a live truck
/// route from the backend, decodes and draws the returned polyline, and
/// displays dynamic ETA / distance / maneuver information together with the
/// Phase 5 intelligence overlay (driveMinutesLeft, weather, riskScore).
class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  // ── Loading / error ────────────────────────────────────────────────────────
  bool _isLoading = false;
  String? _error;

  // ── Full route response ────────────────────────────────────────────────────
  Map<String, dynamic>? _routeData;

  // ── Map route points (decoded polyline) ────────────────────────────────────
  List<LatLng> _routePoints = const [_origin, _destination];

  // ── Phase 5 intelligence (driveMinutesLeft, weather, riskScore) ────────────
  Map<String, dynamic> _intelligence = const {
    'driveMinutesLeft': null,
    'weather': null,
    'riskScore': null,
  };

  // ── Map controller ─────────────────────────────────────────────────────────
  final MapController _mapController = MapController();

  // ── Default route endpoints (Portland, OR → Winnemucca, NV) ───────────────
  static const _originLat = 45.5231;
  static const _originLng = -122.6765;
  static const _destLat = 39.5296;
  static const _destLng = -119.8138;

  static const _origin = LatLng(_originLat, _originLng);
  static const _destination = LatLng(_destLat, _destLng);

  // ── Mapbox public tile access token ──────────────────────────────────────────
  static const _mapboxToken =
      'pk.eyJ1Ijoic2VtaXRyYWNrLTExIiwiYSI6ImNtbmFoeHRoNjBqcjcycXE2ZWk5cGpzNGMifQ.09eo4qJKyLZq_3aUEXWiAA';

  @override
  void initState() {
    super.initState();
  }

  // ── Mapbox Directions API integration ─────────────────────────────────────

  /// Fetches a driving route from the Mapbox Directions API and updates all
  /// relevant state fields, including the decoded polyline used by
  /// [drawRouteOnMap].
  Future<void> fetchRoute() async {
    print("fetchRoute started");

    final url =
        "https://api.mapbox.com/directions/v5/mapbox/driving/"
        "-122.6765,45.5231;-119.8138,39.5296"
        "?geometries=polyline&access_token=YOUR_MAPBOX_TOKEN";

    final res = await http.get(Uri.parse(url));
    print("MAPBOX RESPONSE: ${res.body}");

    final data = jsonDecode(res.body);
    final route = data["routes"][0];
    final polyline = route["geometry"];

    setState(() {
      _routeData = {
        "distanceMiles": (route["distance"] / 1609.34).round(),
        "etaMinutes": (route["duration"] / 60).round(),
        "turnByTurn": [
          {"instruction": "Follow mapped route"}
        ]
      };
      _isLoading = false;
    });

    _routePoints = drawRouteOnMap(polyline as String);
  }

  // ── Polyline rendering ─────────────────────────────────────────────────────

  /// Decodes [encodedPolyline] returned by the Mapbox Directions API into a
  /// GeoJSON-style list of [lng, lat] coordinate pairs (precision 5).
  ///
  /// Returns multiple intermediate points — not just start/end — as produced
  /// by the standard Google/Mapbox polyline algorithm.
  List<List<double>> decodePolylineToGeoJson(String encodedPolyline) {
    final points = <List<double>>[];
    int index = 0;
    final length = encodedPolyline.length;
    int lat = 0;
    int lng = 0;
    const factor = 1e5; // precision 5

    while (index < length) {
      int b;
      int shift = 0;
      int result = 0;
      do {
        b = encodedPolyline.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      shift = 0;
      result = 0;
      do {
        b = encodedPolyline.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      // GeoJSON order: [longitude, latitude]
      points.add([lng / factor, lat / factor]);
    }

    return points;
  }

  /// Decodes [encodedPolyline] returned by the backend and returns a list of
  /// [LatLng] points ready for rendering on the map widget.
  ///
  /// Calls [decodePolylineToGeoJson] to obtain [lng, lat] pairs, then converts
  /// them to [LatLng].  Falls back to the static origin → destination pair on
  /// error or empty input.
  List<LatLng> drawRouteOnMap(
    String encodedPolyline, {
    String provider = '',
  }) {
    if (encodedPolyline.isEmpty) return const [_origin, _destination];
    try {
      final geoJsonPoints = decodePolylineToGeoJson(encodedPolyline);
      if (geoJsonPoints.isEmpty) return const [_origin, _destination];
      return geoJsonPoints
          .map((p) => LatLng(p[1], p[0])) // lat = p[1], lng = p[0]
          .toList();
    } catch (_) {
      return const [_origin, _destination];
    }
  }

  // ── Phase 5 intelligence helpers ──────────────────────────────────────────

  /// Extracts a human-readable weather summary from the route response.
  String _extractWeather(Map<String, dynamic> data) {
    final items = data['weather'] as List?;
    if (items != null && items.isNotEmpty) {
      final first = items.first as Map<String, dynamic>;
      final condition = first['condition'] as String?;
      final tempF = first['tempF'];
      if (condition != null) {
        return tempF != null
            ? '$condition · ${(tempF as num).toStringAsFixed(0)}°F'
            : condition;
      }
    }
    return 'Clear skies';
  }

  /// Computes a 0–100 risk score from the alerts list in [data].
  double _computeRiskScore(Map<String, dynamic> data) {
    final alerts = (data['alerts'] as List?) ?? const <dynamic>[];
    double score = 100.0;
    for (final a in alerts) {
      final text = a.toString().toLowerCase();
      if (text.contains('hazmat')) score -= 20;
      if (text.contains('restriction') || text.contains('restricted')) {
        score -= 10;
      }
    }
    return score.clamp(0.0, 100.0);
  }

  // ── Formatting helpers ─────────────────────────────────────────────────────

  String _formatEta(int? minutes) {
    if (minutes == null) return '—';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  String _formatRisk(double? score) {
    if (score == null) return '—';
    if (score >= 90) return '${score.toStringAsFixed(0)} (Low)';
    if (score >= 70) return '${score.toStringAsFixed(0)} (Medium)';
    return '${score.toStringAsFixed(0)} (High)';
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Semitrack NEW'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : fetchRoute,
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Mapbox map widget (flutter_map) ──────────────────────────────
          Expanded(
            flex: 2,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: LatLng(
                      (_originLat + _destLat) / 2,
                      (_originLng + _destLng) / 2,
                    ),
                    initialZoom: 6,
                    onMapReady: fetchRoute,
                  ),
                  children: [
                    TileLayer(
                      // When a MAPBOX_TOKEN is provided (via --dart-define),
                      // use Mapbox Streets tiles. Restrict the token to your
                      // app's bundle ID in the Mapbox dashboard to limit its
                      // exposure. Falls back to OpenStreetMap otherwise.
                      urlTemplate: _mapboxToken.isNotEmpty
                          ? 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}'
                              '?access_token=$_mapboxToken'
                          : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.semitrack.mobile',
                    ),
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: _routePoints,
                          strokeWidth: 5,
                          color: Colors.blue,
                        ),
                      ],
                    ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: _origin,
                          width: 40,
                          height: 40,
                          child: const Icon(
                            Icons.local_shipping,
                            size: 34,
                            color: Colors.blue,
                          ),
                        ),
                        Marker(
                          point: _destination,
                          width: 40,
                          height: 40,
                          child: const Icon(
                            Icons.location_on,
                            size: 34,
                            color: Colors.red,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                if (_isLoading)
                  const Center(child: CircularProgressIndicator()),
              ],
            ),
          ),

          // ── Error banner ─────────────────────────────────────────────────
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'Error: $_error',
                style: const TextStyle(color: Colors.red),
              ),
            ),

          // ── Route info + Phase 5 intelligence ────────────────────────────
          if (_routeData != null)
            Expanded(
              flex: 1,
              child: _buildRouteInfo(_routeData!),
            ),
        ],
      ),
    );
  }

  Widget _buildRouteInfo(Map<String, dynamic> route) {
    final distanceMiles = route['distanceMiles'];
    final etaMinutes = (route['etaMinutes'] as num?)?.toInt();
    final tollsUsd = route['tollsUsd'];
    final fuelGallons = route['fuelGallonsEstimate'];
    final routeMode = route['routeMode'] ?? 'fastest';
    final provider = route['provider'] as String? ?? '';
    final live = route['live'] as Map<String, dynamic>?;
    final warnings =
        (route['truckWarnings'] as List?)?.cast<String>() ?? const <String>[];
    final steps =
        (route['turnByTurn'] as List?)?.cast<Map<String, dynamic>>() ??
            const <Map<String, dynamic>>[];

    final etaText = _formatEta(etaMinutes);

    // Phase 5 intelligence from state.
    final driveMinutesLeft =
        _intelligence['driveMinutesLeft'] as int?;
    final weather = _intelligence['weather'] as String?;
    final riskScore = _intelligence['riskScore'] as double?;

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        // ── Route Summary ────────────────────────────────────────────────
        Card(
          margin: const EdgeInsets.all(12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'Route Summary',
                      style: TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 18),
                    ),
                    const Spacer(),
                    if (provider.isNotEmpty)
                      Chip(
                        label: Text(provider),
                        padding: EdgeInsets.zero,
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                _labelValue('Mode', routeMode),
                const Text('Distance: 9999 mi'),
                const Text('ETA: TEST'),
                if (tollsUsd != null)
                  _labelValue(
                      'Tolls', '\$${(tollsUsd as num).toStringAsFixed(2)}'),
                if (fuelGallons != null)
                  _labelValue('Fuel estimate', '$fuelGallons gal'),
                if (live != null) ...[
                  _labelValue('Traffic', '${live['traffic']}'),
                  _labelValue('Incidents', '${live['incidents']}'),
                ],
              ],
            ),
          ),
        ),

        // ── Phase 5: Drive Intelligence ──────────────────────────────────
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Drive Intelligence',
                  style:
                      TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const SizedBox(height: 8),
                _labelValue('Drive time left', _formatEta(driveMinutesLeft)),
                _labelValue('Weather', weather ?? '—'),
                _labelValue('Risk score', _formatRisk(riskScore)),
              ],
            ),
          ),
        ),

        // ── Truck Warnings ───────────────────────────────────────────────
        if (warnings.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Truck Warnings',
                    style: TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  for (final w in warnings)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber,
                              size: 18, color: Colors.orange),
                          const SizedBox(width: 8),
                          Expanded(child: Text(w)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),

        // ── Turn-by-Turn ─────────────────────────────────────────────────
        if (steps.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Turn-by-Turn',
                    style: TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  for (final step in steps)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 12,
                            child: Text(
                              '${step['step']}',
                              style: const TextStyle(fontSize: 11),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('TEST MANEUVER'),
                                Text(
                                  '${step['distanceMiles']} mi',
                                  style: const TextStyle(
                                      fontSize: 12, color: Colors.grey),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _labelValue(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}
