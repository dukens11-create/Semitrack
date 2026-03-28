import 'package:flutter/material.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';

class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  final _api = ApiClient();
  MapboxMap? mapboxMap;
  Map<String, dynamic>? _route;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchRoute();
  }

  Future<void> _fetchRoute() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');
      final data = await _api.post(
        '/routing/truck-route',
        {
          'origin': {'lat': 45.5231, 'lng': -122.6765},
          'destination': {'lat': 39.5296, 'lng': -119.8138},
          'truck': {
            'heightFt': 13.5,
            'weightLbs': 80000,
            'widthFt': 8.5,
            'lengthFt': 70.0,
            'hazmatEnabled': false,
            'axleCount': 5,
          },
        },
        token: token,
      );
      setState(() {
        _route = data;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Semitrack')),
      body: Stack(
        children: [
          MapWidget(
            key: const ValueKey("mapWidget"),
            resourceOptions: ResourceOptions(
              accessToken: "YOUR_MAPBOX_TOKEN",
            ),
            onMapCreated: (map) {
              mapboxMap = map;
            },
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _buildRoutePanel(),
          ),
        ],
      ),
    );
  }

  Widget _buildRoutePanel() {
    if (_isLoading) {
      return Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: Text('Error: $_error'),
      );
    }

    final route = _route!;
    final turnByTurn = route["turnByTurn"] as List?;
    final firstInstruction = (turnByTurn != null && turnByTurn.isNotEmpty)
        ? turnByTurn[0]["instruction"] as String
        : '';

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text("${route["distanceMiles"]} mi"),
          Text("${route["etaMinutes"] ~/ 60}h ${route["etaMinutes"] % 60}m"),
          Text(firstInstruction),
        ],
      ),
    );
  }
}
