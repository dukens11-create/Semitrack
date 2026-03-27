import 'package:flutter/material.dart';

class FuelScreen extends StatelessWidget {
  const FuelScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const items = [
      ('Pilot', '4.05', 'DEF yes • WEX yes'),
      ('TA', '4.12', 'DEF yes • WEX yes'),
      ('Independent Truck Stop', '3.98', 'DEF no • WEX no'),
    ];

    return ListView(
      children: [
        for (final item in items)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              leading: const Icon(Icons.local_gas_station),
              title: Text('${item.$1}  \$${item.$2}'),
              subtitle: Text(item.$3),
            ),
          ),
      ],
    );
  }
}
