import 'package:flutter/material.dart';

class CommunityScreen extends StatelessWidget {
  const CommunityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const posts = [
      ('Driver Mike', 'Parking at Pilot #221 getting full fast.'),
      ('RoadQueen', 'Rain picking up near Mile 120.'),
      ('AxleBoss', 'CAT scale open and moving quickly.'),
    ];

    return ListView(
      children: [
        for (final p in posts)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.person)),
              title: Text(p.$1),
              subtitle: Text(p.$2),
            ),
          ),
      ],
    );
  }
}
