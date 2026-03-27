import 'package:flutter/material.dart';

class FleetScreen extends StatelessWidget {
  const FleetScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const drivers = [
      ('John Driver', 'Unit 102', 'IN_TRANSIT'),
      ('Sarah Miles', 'Unit 109', 'AT_STOP'),
    ];

    return ListView(
      children: [
        const Card(
          margin: EdgeInsets.all(12),
          child: ListTile(
            title: Text('Fleet Overview'),
            subtitle: Text('Live tracking • analytics • last-mile navigation'),
          ),
        ),
        for (final d in drivers)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: ListTile(
              title: Text(d.$1),
              subtitle: Text('${d.$2} • ${d.$3}'),
            ),
          ),
      ],
    );
  }
}
