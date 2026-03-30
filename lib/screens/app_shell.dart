import 'package:flutter/material.dart';
import '../services/navigation_state_controller.dart';
import 'driver_dashboard_screen.dart';
import 'truck_map_screen.dart';
import 'trips_screen.dart';
import 'documents_screen.dart';
import 'profile_screen.dart';

class AppShell extends StatefulWidget {
  final NavigationStateController navigationStateController;

  const AppShell({super.key, required this.navigationStateController});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _currentIndex = 0;

  late final List<Widget> _screens = [
    // late final (not const) because widgets receive the navigationStateController
    // instance, which is not a compile-time constant.
    DriverDashboardScreen(
      navigationStateController: widget.navigationStateController,
      onOpenMapTab: () => setState(() => _currentIndex = 1),
    ),
    TruckMapScreen(
      navigationStateController: widget.navigationStateController,
    ),
    const TripsScreen(),
    const DocumentsScreen(),
    const ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: NavigationBar(
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
      ),
    );
  }
}
