import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_client.dart';

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
  static const _destLat = 40.7580;
  static const _destLng = -119.8160;

  static const _origin = LatLng(_originLat, _originLng);
  static const _destination = LatLng(_destLat, _destLng);

  // ── Mapbox public tile access token ──────────────────────────────────────────
  static const _mapboxToken =
      'pk.eyJ1Ijoic2VtaXRyYWNrLTExIiwiYSI6ImNtbmFoeHRoNjBqcjcycXE2ZWk5cGpzNGMifQ.09eo4qJKyLZq_3aUEXWiAA';

  @override
  void initState() {
    super.initState();
    fetchRoute();
  }

  // ── Backend integration ────────────────────────────────────────────────────

  /// Fetches a truck-safe route from the backend `/routing/truck-route`
  /// endpoint and updates all relevant state fields, including the decoded
  /// polyline used by [drawRouteOnMap].
  Future<void> fetchRoute() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');

      final data = await ApiClient().post(
        '/routing/truck-route',
        {
          'origin': {'lat': _originLat, 'lng': _originLng},
          'destination': {'lat': _destLat, 'lng': _destLng},
          'truck': {
            'heightFt': 13.5,
            'weightLbs': 80000,
            'widthFt': 8.5,
            'lengthFt': 70.0,
            'hazmatEnabled': false,
            'axleCount': 5,
            'avoidTolls': false,
            'avoidFerries': true,
            'avoidResidential': true,
          },
          'routeMode': 'fastest',
        },
        token: token,
      );

      final routePolyline = data['routePolyline'] as String? ?? '';
      final provider = data['provider'] as String? ?? '';
      final etaMinutes = (data['etaMinutes'] as num?)?.toInt();

      setState(() {
        _routeData = data;

        // Draw decoded polyline on the map.
        _routePoints = drawRouteOnMap(routePolyline, provider: provider);

        // Phase 5 intelligence fields stored as a Map.
        _intelligence = {
          'driveMinutesLeft': etaMinutes,
          'weather': _extractWeather(data),
          'riskScore': _computeRiskScore(data),
        };

        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e is Exception
            ? e.toString().replaceFirst('Exception: ', '')
            : 'Failed to load route. Please try again.';
        _isLoading = false;
      });
    }
  }

  // ── Polyline rendering ─────────────────────────────────────────────────────

  /// Decodes [encodedPolyline] returned by the backend and returns a list of
  /// [LatLng] points ready for rendering on the map widget.
  ///
  /// Dispatches to [_decodeHereFlexiblePolyline] when [provider] is `"HERE"`,
  /// and to [_decodeGooglePolyline] (precision 6) for Mapbox or any other
  /// provider.  Falls back to the static origin → destination pair on error.
  List<LatLng> drawRouteOnMap(
    String encodedPolyline, {
    String provider = '',
  }) {
    if (encodedPolyline.isEmpty) return const [_origin, _destination];
    try {
      if (provider == 'HERE') {
        return _decodeHereFlexiblePolyline(encodedPolyline);
      }
      // Mapbox uses Google Polyline encoding at precision 6.
      return _decodeGooglePolyline(encodedPolyline, precision: 6);
    } catch (_) {
      return const [_origin, _destination];
    }
  }

  /// Decodes a Google-encoded polyline at the given [precision] (5 or 6).
  List<LatLng> _decodeGooglePolyline(String encoded, {int precision = 5}) {
    final points = <LatLng>[];
    int index = 0;
    final length = encoded.length;
    int lat = 0;
    int lng = 0;
    final factor = math.pow(10, precision).toDouble();

    while (index < length) {
      int b;
      int shift = 0;
      int result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      points.add(LatLng(lat / factor, lng / factor));
    }

    return points.isEmpty ? const [_origin, _destination] : points;
  }

  /// Decodes a HERE Flexible Polyline encoded string.
  ///
  /// The header byte encodes the coordinate precision; subsequent characters
  /// are base64url-encoded zigzag-delta values for (lat, lng) pairs.
  List<LatLng> _decodeHereFlexiblePolyline(String encoded) {
    const encTable =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (encoded.isEmpty) return const [_origin, _destination];

    int index = 0;

    int decodeUnsignedValue() {
      int result = 0;
      int shift = 0;
      int c;
      do {
        c = encTable.indexOf(encoded[index++]);
        if (c < 0) throw const FormatException('Invalid HERE polyline char');
        result |= (c & 0x1F) << shift;
        shift += 5;
      } while (c >= 0x20 && index < encoded.length);
      return result;
    }

    int decodeSignedValue() {
      final val = decodeUnsignedValue();
      return (val & 1) != 0 ? ~(val >> 1) : (val >> 1);
    }

    // First character: header containing precision in the lower 4 bits.
    final headerVal = encTable.indexOf(encoded[index++]);
    if (headerVal < 0) return const [_origin, _destination];
    final precision = headerVal & 0x0F;
    final factor = math.pow(10, precision).toDouble();

    final points = <LatLng>[];
    int lastLat = 0;
    int lastLng = 0;

    while (index < encoded.length) {
      lastLat += decodeSignedValue();
      lastLng += decodeSignedValue();
      points.add(LatLng(lastLat / factor, lastLng / factor));
    }

    return points.isEmpty ? const [_origin, _destination] : points;
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
        title: const Text('Truck Route Map'),
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
                if (distanceMiles != null)
                  _labelValue('Distance', '$distanceMiles mi'),
                if (etaText.isNotEmpty) _labelValue('ETA', etaText),
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
                                Text('${step['instruction']}'),
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
