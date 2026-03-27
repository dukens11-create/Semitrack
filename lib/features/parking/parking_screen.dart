import 'package:flutter/material.dart';

class ParkingScreen extends StatelessWidget {
  const ParkingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const items = [
      ('Pilot #221', 'LIMITED', 'Prediction: RED by 10 PM'),
      ('Rest Area Mile 143', 'AVAILABLE', 'Prediction: YELLOW by midnight'),
      ('TA North', 'FULL', 'Prediction: FULL for 2 hours'),
    ];

    return ListView(
      children: [
        for (final item in items)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              title: Text(item.$1),
              subtitle: Text('${item.$2} • ${item.$3}'),
              trailing: ElevatedButton(onPressed: () {}, child: const Text('Report')),
            ),
          ),
      ],
    );
  }
}
