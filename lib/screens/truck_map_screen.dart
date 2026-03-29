import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Full-featured truck navigation screen.
///
/// Integrates a Mapbox map widget (via flutter_map), fetches a live truck
/// route from the backend, parses the returned GeoJSON geometry, and
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

  // ── Map ready state ────────────────────────────────────────────────────────
  bool _mapReady = false;

  // ── Full route response ────────────────────────────────────────────────────
  Map<String, dynamic>? _routeData;

  // ── Map route points (from GeoJSON coordinates) ────────────────────────────
  List<LatLng> _routePoints = const [];

  // ── Truck marker position, bearing, and current route index ───────────────
  LatLng? _truckPosition;
  double _truckBearing = 0.0;
  int _truckIndex = 0;

  // ── GPS subscription + route animation timer ──────────────────────────────
  StreamSubscription<Position>? _gpsSubscription;
  Timer? _animTimer;
  // True while the GPS stream is delivering real position fixes so that the
  // periodic animation timer defers to the GPS-driven updates.
  bool _gpsActive = false;

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
    _startGps();
  }

  @override
  void dispose() {
    _gpsSubscription?.cancel();
    _animTimer?.cancel();
    super.dispose();
  }

  // ── GPS tracking ──────────────────────────────────────────────────────────

  /// Requests location permission and subscribes to the device GPS stream.
  ///
  /// Each position update snaps the truck marker to the nearest route point
  /// ahead of the current position, so the marker always follows the real
  /// device location when available.
  Future<void> _startGps() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) return;
    }
    if (permission == LocationPermission.deniedForever) return;

    const locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    );

    _gpsSubscription = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen(_onGpsPosition);
  }

  /// Handles a new GPS position by snapping the truck to the nearest route
  /// point that is at or ahead of its current index.
  void _onGpsPosition(Position position) {
    if (_routePoints.isEmpty) return;
    _gpsActive = true;
    final gpsPoint = LatLng(position.latitude, position.longitude);
    final nearest = _nearestRouteIndex(gpsPoint);
    if (nearest != _truckIndex) {
      _advanceTruckTo(nearest);
    }
  }

  /// Returns the index of the route point closest to [point], searching only
  /// from the current truck index onward to prevent backward snapping.
  int _nearestRouteIndex(LatLng point) {
    double minDist = double.infinity;
    int nearest = _truckIndex;
    for (int i = _truckIndex; i < _routePoints.length; i++) {
      final d = _distanceBetween(point, _routePoints[i]);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    }
    return nearest;
  }

  // ── Route animation ───────────────────────────────────────────────────────

  /// Starts a periodic timer that advances the truck marker one step along the
  /// route every 200 ms, balancing smooth GPS-style movement against battery
  /// and CPU usage on mobile devices.
  void _startRouteAnimation() {
    _animTimer?.cancel();
    _truckIndex = 0;
    _truckPosition =
        _routePoints.isNotEmpty ? _routePoints.first : null;

    _animTimer = Timer.periodic(const Duration(milliseconds: 300), (_) {
      if (_routePoints.isEmpty) return;
      final nextIndex = _truckIndex + 1;
      if (nextIndex >= _routePoints.length) {
        _animTimer?.cancel();
        return;
      }
      _advanceTruckTo(nextIndex);
    });
  }

  /// Moves the truck marker to the route point at [index], updates the
  /// bearing, and pans the camera to follow.
  void _advanceTruckTo(int index) {
    if (index < 0 || index >= _routePoints.length) return;
    final prev = _routePoints[_truckIndex];
    final next = _routePoints[index];
    setState(() {
      _truckBearing = _bearingBetween(prev, next);
      _truckIndex = index;
      _truckPosition = next;
    });
    if (_mapReady) {
      _mapController.move(next, _mapController.camera.zoom);
    }
  }

  // ── Bearing / distance helpers ────────────────────────────────────────────

  /// Returns the initial bearing in degrees (0–360) from [from] to [to].
  double _bearingBetween(LatLng from, LatLng to) {
    final lat1 = from.latitude * math.pi / 180.0;
    final lat2 = to.latitude * math.pi / 180.0;
    final dLng = (to.longitude - from.longitude) * math.pi / 180.0;
    final y = math.sin(dLng) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    return (math.atan2(y, x) * 180.0 / math.pi + 360.0) % 360.0;
  }

  /// Returns the approximate great-circle distance in metres between [a] and
  /// [b] using the Haversine formula.
  double _distanceBetween(LatLng a, LatLng b) {
    final lat1 = a.latitude * math.pi / 180.0;
    final lat2 = b.latitude * math.pi / 180.0;
    final dLat = lat2 - lat1;
    final dLng = (b.longitude - a.longitude) * math.pi / 180.0;
    final sinDLat = math.sin(dLat / 2);
    final sinDLng = math.sin(dLng / 2);
    final ax =
        sinDLat * sinDLat + math.cos(lat1) * math.cos(lat2) * sinDLng * sinDLng;
    return 6371000 * 2 * math.atan2(math.sqrt(ax), math.sqrt(1 - ax));
  }

  // ── Restricted-zone dataset for truck routing ─────────────────────────────
  //
  // Each entry represents a physical restriction a truck must avoid (low
  // bridge, weight-limited road, etc.).  The proximity check radius is
  // defined in [_isTruckSafe].  The `limit_value` field stores the
  // applicable restriction (height in feet for bridges, tons for weight
  // limits) and is used for display / future enforcement logic.
  static const _restrictedZones = [
    {'lat': 40.123, 'lng': -120.456, 'type': 'low_bridge', 'limit_value': 12.6},
    {'lat': 41.234, 'lng': -121.567, 'type': 'low_bridge', 'limit_value': 13.5},
    {'lat': 39.876, 'lng': -119.234, 'type': 'weight_limit', 'limit_value': 40.0},
  ];

  // ── Mapbox Directions API integration ─────────────────────────────────────

  /// Decodes a Mapbox polyline6-encoded geometry string into a list of
  /// [LatLng] coordinates.
  ///
  /// polyline6 uses a precision factor of 1×10⁶ (vs 1×10⁵ for polyline5),
  /// giving sub-metre accuracy.  The algorithm is identical to the standard
  /// Mapbox/Google polyline algorithm aside from the division factor.
  List<LatLng> _decodePolyline6(String encoded) {
    final List<LatLng> points = [];
    int index = 0;
    int lat = 0;
    int lng = 0;

    while (index < encoded.length) {
      int result = 0;
      int shift = 0;
      int b;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lat += dlat;

      result = 0;
      shift = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlng = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lng += dlng;

      points.add(LatLng(lat / 1e6, lng / 1e6));
    }
    return points;
  }

  /// Returns `true` when none of the [routePoints] pass within 100 m of a
  /// restricted zone in [_restrictedZones].
  bool _isTruckSafe(List<LatLng> routePoints) {
    const double radiusMeters = 100.0;
    for (final zone in _restrictedZones) {
      final zonePt =
          LatLng(zone['lat']! as double, zone['lng']! as double);
      for (final pt in routePoints) {
        if (_distanceBetween(pt, zonePt) <= radiusMeters) return false;
      }
    }
    return true;
  }

  /// Fetches a driving route from the Mapbox Directions API and updates all
  /// relevant state fields, including the decoded polyline6 coordinates used
  /// to draw the route on the map.
  ///
  /// When [alternative] is `true` the second route returned by Mapbox is used
  /// instead of the primary one, allowing the caller to avoid a route that
  /// fails the [_isTruckSafe] check.
  Future<void> fetchRoute({bool alternative = false}) async {
    print("fetchRoute started (alternative: $alternative)");

    // Clear the old route line before fetching a new one.
    setState(() {
      _isLoading = true;
      _routePoints = [];
      _error = null;
    });

    try {
      final url =
          "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/"
          "-122.6765,45.5231;-119.8138,39.5296"
          "?overview=full"
          "&geometries=polyline6"
          "&steps=true"
          "&alternatives=true"
          "&exclude=ferry"
          "&access_token=$_mapboxToken";

      final res = await http.get(Uri.parse(url));
      print("MAPBOX RESPONSE: ${res.body}");

      final data = jsonDecode(res.body);
      final routes = data["routes"] as List;
      // Use the alternative route (index 1) when requested and available,
      // otherwise fall back to the primary route (index 0).
      final routeIndex =
          (alternative && routes.length > 1) ? 1 : 0;
      final route = routes[routeIndex] as Map<String, dynamic>;

      // Decode polyline6 geometry into LatLng points.
      final newPoints = _decodePolyline6(route["geometry"] as String);

      // Check whether the decoded route avoids all restricted zones.
      // If it does not, automatically re-fetch using the alternative route.
      // When already on the alternative, we accept the route regardless —
      // no further candidates are available to try.
      if (!_isTruckSafe(newPoints) && !alternative) {
        print("Route is not truck-safe – fetching alternative route");
        await fetchRoute(alternative: true);
        return;
      }

      // Extract the first step instruction from the directions response.
      final firstInstruction = _extractFirstInstruction(route);

      setState(() {
        _routeData = {
          "distanceMiles": (route["distance"] / 1609.34).round(),
          "etaMinutes": (route["duration"] / 60).round(),
          "turnByTurn": [
            {"instruction": firstInstruction}
          ]
        };
        _routePoints = newPoints;
        _isLoading = false;
      });

      _fitCameraToRoute(newPoints);
      _startRouteAnimation();
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  /// Extracts the instruction text from the first maneuver step of [route].
  ///
  /// Returns the instruction string from `legs[0].steps[0].maneuver.instruction`,
  /// or `'Follow mapped route'` when the field is absent.
  String _extractFirstInstruction(Map<String, dynamic> route) {
    final legs = route['legs'] as List?;
    if (legs == null || legs.isEmpty) return 'Follow mapped route';
    final steps = legs[0]['steps'] as List?;
    if (steps == null || steps.isEmpty) return 'Follow mapped route';
    final maneuver = (steps[0] as Map<String, dynamic>)['maneuver']
        as Map<String, dynamic>?;
    return maneuver?['instruction'] as String? ?? 'Follow mapped route';
  }

  /// Fits the map camera to the first 10 route points at navigation zoom
  /// so the view opens close to the truck's starting position.
  void _fitCameraToRoute(List<LatLng> points) {
    if (!_mapReady || points.length < 2) return;
    final segment = points.length > 10 ? points.sublist(0, 10) : points;
    final bounds = LatLngBounds.fromPoints(segment);
    _mapController.fitCamera(
      CameraFit.bounds(
        bounds: bounds,
        padding: const EdgeInsets.all(50),
        maxZoom: 14.0,
      ),
    );
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
            onPressed: _isLoading ? null : () => fetchRoute(),
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
                    onMapReady: () {
                      _mapReady = true;
                      fetchRoute();
                    },
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
                        if (_routePoints.isNotEmpty)
                          Polyline(
                            points: _routePoints,
                            strokeWidth: 5,
                            color: Colors.blue,
                            strokeJoin: StrokeJoin.round,
                            strokeCap: StrokeCap.round,
                          ),
                      ],
                    ),
                    MarkerLayer(
                      markers: [
                        // ── Truck marker (animated + rotated) ──────────────
                        Marker(
                          point: _truckPosition ??
                              (_routePoints.isNotEmpty
                                  ? _routePoints.first
                                  : _origin),
                          width: 40,
                          height: 40,
                          child: Transform.rotate(
                            angle: _truckBearing * math.pi / 180.0,
                            child: const Icon(
                              Icons.local_shipping,
                              size: 34,
                              color: Colors.blue,
                            ),
                          ),
                        ),
                        // ── Destination marker ──────────────────────────────
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
    final steps = route['turnByTurn'] as List?;

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
                Text('Distance: ${distanceMiles ?? "--"} mi'),
                Text('ETA: $etaText'),
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
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Builder(builder: (context) {
              final Map<String, dynamic>? step0 =
                  steps != null && steps.isNotEmpty
                      ? (steps[0] is Map<String, dynamic>
                          ? steps[0] as Map<String, dynamic>
                          : null)
                      : null;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Turn-by-Turn',
                    style: TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    step0 != null
                        ? step0['instruction'] as String? ?? 'Continue'
                        : 'Loading...',
                  ),
                  Text(
                    step0 != null
                        ? '${step0['distance'] ?? '--'} mi'
                        : '--',
                    style:
                        const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ],
              );
            }),
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
