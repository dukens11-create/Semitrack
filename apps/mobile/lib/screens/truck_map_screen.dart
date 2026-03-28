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
  bool _loading = false;
  String? _error;

  // ── Route data ─────────────────────────────────────────────────────────────
  double? _distanceMiles;
  int? _etaMinutes;
  String _nextManeuver = '';
  String _provider = '';
  List<String> _alerts = [];

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

  // ── Default route endpoints (Portland → Eugene, OR) ───────────────────────
  static const _origin = LatLng(45.5231, -122.6765);
  static const _destination = LatLng(44.0521, -123.0868);

  // ── Mapbox public tile access token (set via --dart-define=MAPBOX_TOKEN=...) ─
  static const _mapboxToken =
      String.fromEnvironment('MAPBOX_TOKEN', defaultValue: '');

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
      _loading = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');

      final data = await ApiClient().post(
        '/routing/truck-route',
        {
          'origin': {
            'lat': _origin.latitude,
            'lng': _origin.longitude,
          },
          'destination': {
            'lat': _destination.latitude,
            'lng': _destination.longitude,
          },
          'truck': {
            'heightFt': 13.6,
            'weightLbs': 80000,
            'widthFt': 8.5,
            'lengthFt': 53.0,
            'hazmatEnabled': false,
            'axleCount': 5,
          },
        },
        token: token,
      );

      final steps = (data['turnByTurn'] as List?) ?? <dynamic>[];
      final routePolyline = data['routePolyline'] as String? ?? '';
      final provider = data['provider'] as String? ?? '';
      final etaMinutes = (data['etaMinutes'] as num?)?.toInt();
      final distanceMiles = (data['distanceMiles'] as num?)?.toDouble();
      final alerts = (data['alerts'] as List?)?.cast<String>() ?? <String>[];

      setState(() {
        _distanceMiles = distanceMiles;
        _etaMinutes = etaMinutes;
        _provider = provider;
        _nextManeuver = steps.isNotEmpty
            ? (steps.first as Map<String, dynamic>)['instruction'] as String? ??
                ''
            : '';
        _alerts = alerts;

        // Draw decoded polyline on the Mapbox map.
        _routePoints = drawRouteOnMap(routePolyline, provider: provider);

        // Phase 5 intelligence fields stored as a Map.
        _intelligence = {
          'driveMinutesLeft': etaMinutes,
          'weather': _extractWeather(data),
          'riskScore': _computeRiskScore(data),
        };

        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Failed to fetch route. Please try again.';
        _loading = false;
      });
    }
  }

  // ── Polyline rendering ─────────────────────────────────────────────────────

  /// Decodes [encodedPolyline] returned by the backend and returns a list of
  /// [LatLng] points ready for rendering on the Mapbox map widget.
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
  ///
  /// If a `/weather/route` response is merged into [data] this will surface
  /// the first checkpoint's condition; otherwise returns `'Clear skies'`.
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
  ///
  /// Each hazmat or restriction alert deducts points from the baseline of 100.
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

  String _formatDistance(double? miles) {
    if (miles == null) return '—';
    return '${miles.toStringAsFixed(1)} mi';
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
    final intelligence = _intelligence;
    final driveMinutesLeft = intelligence['driveMinutesLeft'] as int?;
    final weather = intelligence['weather'] as String?;
    final riskScore = intelligence['riskScore'] as double?;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Truck Map'),
        actions: [
          if (_loading)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh route',
              onPressed: fetchRoute,
            ),
        ],
      ),
      body: ListView(
        children: [
          // ── Mapbox map widget ────────────────────────────────────────────
          SizedBox(
            height: 320,
            child: FlutterMap(
              mapController: _mapController,
              options: const MapOptions(
                initialCenter: _origin,
                initialZoom: 8,
              ),
              children: [
                TileLayer(
                  // When a MAPBOX_TOKEN is provided (via --dart-define), use
                  // Mapbox Streets tiles. Restrict the token to your app's
                  // bundle ID and allowed URLs in the Mapbox dashboard to
                  // limit its exposure. Falls back to OpenStreetMap otherwise.
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
          ),

          // ── Error banner ─────────────────────────────────────────────────
          if (_error != null)
            Container(
              color: Colors.red.shade50,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: Colors.red),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                ],
              ),
            ),

          // ── Live route card ───────────────────────────────────────────────
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
                        'Live Truck Route',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 20,
                        ),
                      ),
                      const Spacer(),
                      if (_provider.isNotEmpty)
                        Chip(
                          label: Text(_provider),
                          padding: EdgeInsets.zero,
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _InfoRow(
                    label: 'Next maneuver',
                    value: _loading
                        ? 'Calculating route…'
                        : _nextManeuver.isEmpty
                            ? '—'
                            : _nextManeuver,
                  ),
                  _InfoRow(
                    label: 'ETA',
                    value: _loading ? '…' : _formatEta(_etaMinutes),
                  ),
                  _InfoRow(
                    label: 'Distance',
                    value: _loading ? '…' : _formatDistance(_distanceMiles),
                  ),
                  if (_alerts.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    const Text(
                      'Alerts',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    for (final alert in _alerts)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.info_outline,
                              size: 16,
                              color: Colors.orange,
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                alert,
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),

          // ── Phase 5 intelligence card ─────────────────────────────────────
          Card(
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Drive Intelligence',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                  const SizedBox(height: 12),
                  _InfoRow(
                    label: 'Drive time left',
                    value: _loading ? '…' : _formatEta(driveMinutesLeft),
                  ),
                  _InfoRow(
                    label: 'Weather',
                    value: _loading ? 'Loading…' : (weather ?? '—'),
                  ),
                  _InfoRow(
                    label: 'Risk score',
                    value: _loading ? '…' : _formatRisk(riskScore),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Shared row widget ──────────────────────────────────────────────────────────

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
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
