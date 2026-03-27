import 'package:flutter/material.dart';

class LoadBoardScreen extends StatelessWidget {
  const LoadBoardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const loads = [
      ('ABC Logistics', 'Portland, OR', 'Reno, NV', '\$1800'),
      ('West Lane Freight', 'Seattle, WA', 'Boise, ID', '\$2100'),
    ];

    return ListView(
      children: [
        for (final l in loads)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              title: Text(l.$1),
              subtitle: Text('${l.$2} → ${l.$3}'),
              trailing: Text(l.$4),
            ),
          ),
      ],
    );
  }
}
