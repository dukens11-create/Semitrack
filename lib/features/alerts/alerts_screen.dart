import 'package:flutter/material.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const items = [
      ('Low Bridge Ahead', 'Critical', 'Mile 132'),
      ('High Wind Advisory', 'High', 'Mile 188'),
      ('Traffic Congestion', 'Medium', 'Mile 205'),
      ('Restricted Road Avoided', 'Info', 'Applied to route'),
    ];

    return ListView(
      children: [
        for (final item in items)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              leading: const Icon(Icons.warning_amber),
              title: Text(item.$1),
              subtitle: Text('${item.$2} • ${item.$3}'),
            ),
          ),
      ],
    );
  }
}
