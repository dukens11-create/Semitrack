import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

const _apiBase = 'http://10.0.2.2:4000';

class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  MapboxMap? mapboxMap;
  Map<String, dynamic>? _routeData;
  bool _loading = false;
  String? _error;

  // Default route: Portland, OR → Seattle, WA
  final _origin = {'lat': 45.5231, 'lng': -122.6765};
  final _destination = {'lat': 47.6062, 'lng': -122.3321};

  @override
  void initState() {
    super.initState();
    _fetchRoute();
  }

  Future<void> _fetchRoute() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final res = await http.post(
        Uri.parse('$_apiBase/routing/truck-route'),
        headers: {'Content-Type': 'application/json'},
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
            'avoidFerries': false,
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
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _drawRoute(Map<String, dynamic> data) async {
    if (mapboxMap == null) return;

    final coordinates = [
      Position(_origin['lng']!, _origin['lat']!),
      Position(_destination['lng']!, _destination['lat']!),
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
        geometry: Point(
          coordinates: Position(_origin['lng']!, _origin['lat']!),
        ),
        textField: 'Origin',
        textOffset: [0.0, -2.0],
        iconSize: 1.5,
      ),
    );
    await pointManager.create(
      PointAnnotationOptions(
        geometry: Point(
          coordinates: Position(_destination['lng']!, _destination['lat']!),
        ),
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
    final steps =
        (_routeData?['turnByTurn'] as List<dynamic>?) ?? <dynamic>[];
    final warnings =
        (_routeData?['truckWarnings'] as List<dynamic>?) ?? <dynamic>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Truck Route'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _fetchRoute,
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
                        (_origin['lng']! + _destination['lng']!) / 2,
                        (_origin['lat']! + _destination['lat']!) / 2,
                      ),
                    ),
                    zoom: 7.0,
                  ),
                ),
                if (_loading)
                  const Center(child: CircularProgressIndicator()),
                if (_error != null)
                  Center(
                    child: Container(
                      color: Colors.red.withOpacity(0.8),
                      padding: const EdgeInsets.all(8),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            flex: 1,
            child: _routeData == null
                ? const Center(child: Text('Fetching route...'))
                : ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          _StatChip(
                            icon: Icons.straighten,
                            label:
                                '${_routeData!['distanceMiles'] ?? '--'} mi',
                          ),
                          _StatChip(
                            icon: Icons.timer,
                            label: '${_routeData!['etaMinutes'] ?? '--'} min',
                          ),
                          _StatChip(
                            icon: Icons.local_gas_station,
                            label:
                                '${_routeData!['fuelGallonsEstimate'] ?? '--'} gal',
                          ),
                        ],
                      ),
                      if (warnings.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text(
                          'Warnings',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        for (final w in warnings)
                          ListTile(
                            dense: true,
                            leading: const Icon(
                              Icons.warning_amber,
                              color: Colors.orange,
                            ),
                            title: Text(w.toString()),
                          ),
                      ],
                      if (steps.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text(
                          'Turn-by-Turn',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        for (final step in steps)
                          ListTile(
                            dense: true,
                            leading: const Icon(Icons.navigation),
                            title: Text(
                              (step as Map<dynamic, dynamic>)['instruction']
                                  .toString(),
                            ),
                            trailing: Text('${step['distanceMiles']} mi'),
                          ),
                      ],
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _StatChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(icon, size: 16),
      label: Text(label),
    );
  }
}
