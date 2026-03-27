import 'package:flutter/material.dart';

class SubscriptionsScreen extends StatelessWidget {
  const SubscriptionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const plans = [
      ('Free', '\$0/mo', 'Basic map, basic POI, limited routing'),
      ('Gold', '\$29.99/mo', 'Truck routing, parking, fuel, weather'),
      ('Diamond', '\$59.99/mo', 'Advanced routing, offline maps, fleet, analytics'),
      ('Team', '\$199.99/mo', 'Company accounts, reports, documents'),
    ];

    return ListView(
      children: [
        for (final p in plans)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              title: Text('${p.$1} • ${p.$2}'),
              subtitle: Text(p.$3),
              trailing: ElevatedButton(onPressed: () {}, child: const Text('Choose')),
            ),
          ),
      ],
    );
  }
}
