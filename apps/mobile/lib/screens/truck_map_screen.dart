import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _apiBase = 'http://10.0.2.2:4000';

class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  MapboxMap? mapboxMap;
  Map<String, dynamic>? _routeData;
  bool _isLoading = false;
  String? _error;

  static const _originLat = 45.5231;
  static const _originLng = -122.6765;
  static const _destLat = 40.7580;
  static const _destLng = -119.8160;

  static const _origin = {'lat': _originLat, 'lng': _originLng};
  static const _destination = {'lat': _destLat, 'lng': _destLng};

  @override
  void initState() {
    super.initState();
    _fetchRoute();
  }

  Future<void> _fetchRoute() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');

      final headers = <String, String>{'Content-Type': 'application/json'};
      if (token != null) headers['Authorization'] = 'Bearer $token';

      final res = await http.post(
        Uri.parse('$_apiBase/routing/truck-route'),
        headers: headers,
        body: jsonEncode({
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
        }),
      );

      if (res.statusCode != 200) {
        throw Exception('Route request failed (${res.statusCode})');
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      setState(() => _routeData = data);
      if (mapboxMap != null) {
        await _drawRoute(data);
      }
    } catch (e) {
      setState(() {
        _error = e is Exception
            ? e.toString().replaceFirst('Exception: ', '')
            : 'Failed to load route. Please try again.';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _drawRoute(Map<String, dynamic> data) async {
    if (mapboxMap == null) return;

    final coordinates = [
      Position(_originLng, _originLat),
      Position(_destLng, _destLat),
    ];

    final lineManager =
        await mapboxMap!.annotations.createPolylineAnnotationManager();
    await lineManager.create(
      PolylineAnnotationOptions(
        geometry: LineString(coordinates: coordinates),
        lineColor: Colors.blue.value,
        lineWidth: 5.0,
      ),
    );

    final pointManager =
        await mapboxMap!.annotations.createPointAnnotationManager();
    await pointManager.create(
      PointAnnotationOptions(
        geometry: Point(coordinates: Position(_originLng, _originLat)),
        textField: 'Origin',
        textOffset: [0.0, -2.0],
        iconSize: 1.5,
      ),
    );
    await pointManager.create(
      PointAnnotationOptions(
        geometry: Point(coordinates: Position(_destLng, _destLat)),
        textField: 'Destination',
        textOffset: [0.0, -2.0],
        iconSize: 1.5,
      ),
    );
  }

  void _onMapCreated(MapboxMap map) {
    mapboxMap = map;
    if (_routeData != null) {
      _drawRoute(_routeData!);
    }
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
      body: Column(
        children: [
          Expanded(
            flex: 2,
            child: Stack(
              children: [
                MapWidget(
                  onMapCreated: _onMapCreated,
                  styleUri: MapboxStyles.MAPBOX_STREETS,
                  cameraOptions: CameraOptions(
                    center: Point(
                      coordinates: Position(
                        (_originLng + _destLng) / 2,
                        (_originLat + _destLat) / 2,
                      ),
                    ),
                    zoom: 6.0,
                  ),
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

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        Card(
          margin: const EdgeInsets.all(12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
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
        ),
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
                    style:
                        TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
                    style:
                        TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
