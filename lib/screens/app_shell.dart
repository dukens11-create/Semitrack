import 'package:flutter/material.dart';
import 'driver_dashboard_screen.dart';
import 'truck_map_screen.dart';
import 'trips_screen.dart';
import 'documents_screen.dart';
import 'profile_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  // Open on Map tab by default
  int _currentIndex = 1;

  final List<Widget> _screens = const [
    DriverDashboardScreen(),
    TruckMapScreen(),
    TripsScreen(),
    DocumentsScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      // ── Bottom navigation bar ──────────────────────────────────────────────
      // Hidden during active turn-by-turn navigation so the driver sees only
      // the map and navigation components.  [TruckMapScreen.isNavigatingNotifier]
      // broadcasts the navigation state; [ValueListenableBuilder] rebuilds
      // just this widget when the flag changes, keeping the rest of the tree
      // stable.
      bottomNavigationBar: ValueListenableBuilder<bool>(
        valueListenable: TruckMapScreen.isNavigatingNotifier,
        builder: (context, isNavigating, _) {
          // Fully remove the bar during navigation by returning an empty widget.
          if (isNavigating) return const SizedBox.shrink();
          return NavigationBar(
            selectedIndex: _currentIndex,
            onDestinationSelected: (index) {
              setState(() {
                _currentIndex = index;
              });
            },
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home),
                label: 'Home',
              ),
              NavigationDestination(
                icon: Icon(Icons.map_outlined),
                selectedIcon: Icon(Icons.map),
                label: 'Map',
              ),
              NavigationDestination(
                icon: Icon(Icons.route_outlined),
                selectedIcon: Icon(Icons.route),
                label: 'Trips',
              ),
              NavigationDestination(
                icon: Icon(Icons.description_outlined),
                selectedIcon: Icon(Icons.description),
                label: 'Docs',
              ),
              NavigationDestination(
                icon: Icon(Icons.person_outline),
                selectedIcon: Icon(Icons.person),
                label: 'Profile',
              ),
            ],
          );
        },
      ),
    );
  }
}
