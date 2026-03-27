import 'package:flutter/material.dart';

class OfflineMapsScreen extends StatelessWidget {
  const OfflineMapsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const regions = [
      ('Oregon', 'Downloaded'),
      ('Washington', 'Not downloaded'),
      ('Idaho', 'Not downloaded'),
      ('Nevada', 'Queued'),
    ];

    return ListView(
      children: [
        for (final r in regions)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              title: Text(r.$1),
              subtitle: Text(r.$2),
              trailing: ElevatedButton(
                onPressed: () {},
                child: const Text('Manage'),
              ),
            ),
          ),
      ],
    );
  }
}
