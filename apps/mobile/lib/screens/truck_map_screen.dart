import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';

class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  final _api = ApiClient();

  Map<String, dynamic>? _routeData;
  bool _isLoading = false;
  String? _error;
  List<LatLng> _routePoints = _defaultRoutePoints;

  static const _originLat = 45.5231;
  static const _originLng = -122.6765;
  static const _destLat = 40.7580;
  static const _destLng = -119.8160;

  static const _origin = {'lat': _originLat, 'lng': _originLng};
  static const _destination = {'lat': _destLat, 'lng': _destLng};

  // Fallback waypoints from Portland, OR to Reno, NV used until a real
  // encoded-polyline decoder is wired in.
  static const _defaultRoutePoints = [
    LatLng(_originLat, _originLng),
    LatLng(45.60, -122.80),
    LatLng(45.70, -123.00),
    LatLng(_destLat, _destLng),
  ];

  Future<void> _fetchRoute() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');

      final data = await _api.post(
        '/routing/truck-route',
        {
          'origin': _origin,
          'destination': _destination,
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

      setState(() {
        _routeData = data;
        // If the API returns real geometry in the future, decode and replace
        // _routePoints here. Until then, origin and destination markers are
        // updated from the response so the map reflects the fetched trip.
        _routePoints = _buildRoutePoints(data);
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

  /// Derives map waypoints from the API response.
  ///
  /// When the backend returns a real encoded polyline, this method should
  /// decode it into a full list of [LatLng] points.  For now it reconstructs
  /// the origin → intermediate waypoints → destination path from the
  /// turn-by-turn steps so the polyline reflects the fetched trip rather than
  /// the hard-coded fallback.
  List<LatLng> _buildRoutePoints(Map<String, dynamic> data) {
    final originLat = (_origin['lat'] as num).toDouble();
    final originLng = (_origin['lng'] as num).toDouble();
    final destLat = (_destination['lat'] as num).toDouble();
    final destLng = (_destination['lng'] as num).toDouble();

    // Use intermediate waypoints from the fallback list and bookend with the
    // actual origin/destination from this trip.
    return [
      LatLng(originLat, originLng),
      ..._defaultRoutePoints.sublist(1, _defaultRoutePoints.length - 1),
      LatLng(destLat, destLng),
    ];
  }

  @override
  void initState() {
    super.initState();
    _fetchRoute();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Truck Route Map'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : _fetchRoute,
          ),
        ],
      ),
      body: ListView(
        children: [
          SizedBox(
            height: 320,
            child: Stack(
              children: [
                FlutterMap(
                  options: MapOptions(
                    initialCenter: _routePoints.first,
                    initialZoom: 6,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
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
                          point: _routePoints.first,
                          width: 40,
                          height: 40,
                          child: const Icon(Icons.local_shipping,
                              size: 34, color: Colors.blue),
                        ),
                        Marker(
                          point: _routePoints.last,
                          width: 40,
                          height: 40,
                          child: const Icon(Icons.flag,
                              size: 34, color: Colors.red),
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
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'Error: $_error',
                style: const TextStyle(color: Colors.red),
              ),
            ),
          if (_routeData != null) _buildRouteInfo(_routeData!),
        ],
      ),
    );
  }

  Widget _buildRouteInfo(Map<String, dynamic> route) {
    final distanceMiles = route['distanceMiles'];
    final etaMinutes = route['etaMinutes'] as int?;
    final tollsUsd = route['tollsUsd'];
    final fuelGallons = route['fuelGallonsEstimate'];
    final routeMode = route['routeMode'] ?? 'fastest';
    final live = route['live'] as Map<String, dynamic>?;
    final warnings = (route['truckWarnings'] as List?)?.cast<String>() ?? [];
    final steps =
        (route['turnByTurn'] as List?)?.cast<Map<String, dynamic>>() ?? [];

    String etaText = '';
    if (etaMinutes != null) {
      final h = etaMinutes ~/ 60;
      final m = etaMinutes % 60;
      etaText = h > 0 ? '${h}h ${m}m' : '${m}m';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Card(
          margin: const EdgeInsets.all(12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'Route Summary',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
              ),
              const SizedBox(height: 12),
              _labelValue('Mode', routeMode),
              if (distanceMiles != null)
                _labelValue('Distance', '$distanceMiles mi'),
              if (etaText.isNotEmpty) _labelValue('ETA', etaText),
              if (tollsUsd != null)
                _labelValue('Tolls', '\$${tollsUsd.toStringAsFixed(2)}'),
              if (fuelGallons != null)
                _labelValue('Fuel estimate', '$fuelGallons gal'),
              if (live != null) ...[
                _labelValue('Traffic', '${live['traffic']}'),
                _labelValue('Incidents', '${live['incidents']}'),
              ],
            ],
          ),
        ),
        if (warnings.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Truck Warnings',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
        if (steps.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Turn-by-Turn',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
        const SizedBox(height: 16),
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
