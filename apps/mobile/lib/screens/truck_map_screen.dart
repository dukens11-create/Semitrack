import 'package:flutter/material.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

class TruckMapScreen extends StatefulWidget {
  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  MapboxMap? mapboxMap;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("Semitrack")),
      body: MapWidget(
        key: const ValueKey("mapWidget"),
        resourceOptions: ResourceOptions(
          accessToken: "YOUR_MAPBOX_TOKEN",
        ),
        onMapCreated: (map) {
          mapboxMap = map;
        },
      ),
    );
  }
}
