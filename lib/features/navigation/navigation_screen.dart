import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../../core/widgets.dart';

class NavigationScreen extends StatelessWidget {
  const NavigationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Route points are populated from live GPS once navigation is active.
    // A static preview polyline is not shown here to avoid hardcoding a location.
    const List<LatLng> routePoints = [];

    return ListView(
      children: [
        SizedBox(
          height: 320,
          child: FlutterMap(
            options: const MapOptions(
              // Use a neutral US center; the map will follow the device
              // GPS location once navigation begins in TruckMapScreen.
              initialCenter: LatLng(39.5, -98.35),
              initialZoom: 8,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.semitrack.mobile',
              ),
              PolylineLayer(polylines: [Polyline(points: routePoints, strokeWidth: 5)]),
              MarkerLayer(markers: [
                Marker(
                  point: routePoints.first,
                  width: 40,
                  height: 40,
                  child: const Icon(Icons.local_shipping, size: 34),
                ),
              ]),
            ],
          ),
        ),
        const SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Live Truck Route', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              SizedBox(height: 12),
              LabelValue(label: 'Next maneuver', value: 'Take Exit 221 toward freight corridor'),
              LabelValue(label: 'ETA', value: '7h 50m'),
              LabelValue(label: 'Distance', value: '438 mi'),
              LabelValue(label: 'Mode', value: 'Fastest'),
              LabelValue(label: 'Traffic', value: 'Moderate'),
              LabelValue(label: 'Warnings', value: 'Low bridge avoided automatically'),
              LabelValue(label: 'Voice', value: 'Enabled'),
              LabelValue(label: 'Lane guidance', value: 'Available'),
              LabelValue(label: 'Junction view', value: 'Available'),
            ],
          ),
        ),
      ],
    );
  }
}
