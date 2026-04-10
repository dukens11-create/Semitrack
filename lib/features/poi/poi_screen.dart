import 'package:flutter/material.dart';

class PoiScreen extends StatelessWidget {
  const PoiScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Walmart store locations are NOT listed here as hardcoded entries.
    // All Walmart markers come exclusively from assets/walmart-stores.json
    // via loadWalmartPois() in poi_service.dart and are rendered on the map.
    const items = [
      ('Pilot Travel Center', 'Showers • Parking • Diesel • Food'),
      ("Love's Travel Stop", 'Laundry • DEF • Parking'),
      ('TA Truck Service', 'Repair • Parking • Fuel'),
      ('Walmart Store', 'Loaded from walmart-stores.json'),
      ('Weigh Station', 'Open / Closed status'),
    ];

    return ListView(
      children: [
        const Padding(
          padding: EdgeInsets.all(12),
          child: SearchBar(hintText: 'Search nearby truck stops, repairs, Walmart, scales'),
        ),
        for (final item in items)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: ListTile(
              leading: const Icon(Icons.place),
              title: Text(item.$1),
              subtitle: Text(item.$2),
              trailing: const Icon(Icons.chevron_right),
            ),
          ),
      ],
    );
  }
}
