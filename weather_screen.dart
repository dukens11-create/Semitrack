import 'package:flutter/material.dart';

class WeatherScreen extends StatelessWidget {
  const WeatherScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const checkpoints = [
      ('Mile 0', 'Clear', '56°F'),
      ('Mile 120', 'Rain', '48°F'),
      ('Mile 260', 'Snow risk', '31°F'),
    ];

    return ListView(
      children: [
        const Card(
          margin: EdgeInsets.all(12),
          child: ListTile(
            title: Text('Route Weather Summary'),
            subtitle: Text('Mixed weather along route'),
          ),
        ),
        for (final c in checkpoints)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: ListTile(
              title: Text(c.$1),
              subtitle: Text('${c.$2} • ${c.$3}'),
            ),
          ),
      ],
    );
  }
}
