import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class AppLayout extends StatelessWidget {
  final Widget child;
  const AppLayout({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final items = const [
      ('Dashboard', '/dashboard', Icons.dashboard),
      ('Navigation', '/navigation', Icons.map),
      ('Trips', '/trips', Icons.route),
      ('POI', '/poi', Icons.place),
      ('Parking', '/parking', Icons.local_parking),
      ('Fuel', '/fuel', Icons.local_gas_station),
      ('Scales', '/weigh-stations', Icons.scale),
      ('Alerts', '/alerts', Icons.warning_amber),
      ('Weather', '/weather', Icons.cloud),
      ('Offline', '/offline', Icons.download),
      ('Profile', '/profile', Icons.person),
      ('Community', '/community', Icons.groups),
      ('Fleet', '/fleet', Icons.local_shipping),
      ('Loads', '/load-board', Icons.inventory_2),
      ('Docs', '/documents', Icons.description),
      ('Plans', '/subscriptions', Icons.workspace_premium),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Semitrack')),
      drawer: Drawer(
        child: ListView(
          children: [
            const DrawerHeader(
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text('Semitrack Menu', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              ),
            ),
            for (final item in items)
              ListTile(
                leading: Icon(item.$3),
                title: Text(item.$1),
                onTap: () {
                  Navigator.pop(context);
                  context.go(item.$2);
                },
              ),
          ],
        ),
      ),
      body: child,
    );
  }
}
