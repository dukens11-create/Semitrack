import 'package:flutter/material.dart';

class WeighStationsScreen extends StatelessWidget {
  const WeighStationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const items = [
      ('Northbound Weigh Station', 'OPEN'),
      ('CAT Scale - Pilot', 'OPEN'),
      ('South Freight Scale', 'CLOSED'),
    ];

    return ListView(
      children: [
        for (final item in items)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              leading: const Icon(Icons.scale),
              title: Text(item.$1),
              subtitle: Text('Status: ${item.$2}'),
            ),
          ),
      ],
    );
  }
}
