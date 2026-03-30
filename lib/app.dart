import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/layout.dart';
import 'features/navigation/navigation_screen.dart';
import 'features/trip_planner/trip_planner_screen.dart';
import 'features/poi/poi_screen.dart';
import 'features/parking/parking_screen.dart';
import 'features/fuel/fuel_screen.dart';
import 'features/weigh_stations/weigh_stations_screen.dart';
import 'features/alerts/alerts_screen.dart';
import 'features/weather/weather_screen.dart';
import 'features/offline/offline_maps_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/community/community_screen.dart';
import 'features/fleet/fleet_screen.dart';
import 'features/load_board/load_board_screen.dart';
import 'features/documents/documents_screen.dart';
import 'features/subscriptions/subscriptions_screen.dart';
import 'screens/trips_screen.dart';

class SemitrackApp extends StatelessWidget {
  const SemitrackApp({super.key});

  @override
  Widget build(BuildContext context) {
    final router = GoRouter(
      initialLocation: '/navigation',
      routes: [
        ShellRoute(
          builder: (context, state, child) => AppLayout(child: child),
          routes: [
            GoRoute(path: '/navigation', builder: (_, __) => const NavigationScreen()),
            GoRoute(path: '/trips', builder: (_, __) => const TripsScreen()),
            GoRoute(path: '/trip-planner', builder: (_, __) => const TripPlannerScreen()),
            GoRoute(path: '/poi', builder: (_, __) => const PoiScreen()),
            GoRoute(path: '/parking', builder: (_, __) => const ParkingScreen()),
            GoRoute(path: '/fuel', builder: (_, __) => const FuelScreen()),
            GoRoute(path: '/weigh-stations', builder: (_, __) => const WeighStationsScreen()),
            GoRoute(path: '/alerts', builder: (_, __) => const AlertsScreen()),
            GoRoute(path: '/weather', builder: (_, __) => const WeatherScreen()),
            GoRoute(path: '/offline', builder: (_, __) => const OfflineMapsScreen()),
            GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
            GoRoute(path: '/community', builder: (_, __) => const CommunityScreen()),
            GoRoute(path: '/fleet', builder: (_, __) => const FleetScreen()),
            GoRoute(path: '/load-board', builder: (_, __) => const LoadBoardScreen()),
            GoRoute(path: '/documents', builder: (_, __) => const DocumentsScreen()),
            GoRoute(path: '/subscriptions', builder: (_, __) => const SubscriptionsScreen()),
          ],
        ),
      ],
    );

    return MaterialApp.router(
      title: 'Semitrack',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
    );
  }
}
