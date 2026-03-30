import 'package:flutter/material.dart';
import '../services/navigation_state_controller.dart';

class DriverDashboardScreen extends StatelessWidget {
  final NavigationStateController navigationStateController;
  final VoidCallback onOpenMapTab;

  const DriverDashboardScreen({
    super.key,
    required this.navigationStateController,
    required this.onOpenMapTab,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: navigationStateController,
      builder: (context, _) {
        final nav = navigationStateController;
        return Scaffold(
          backgroundColor: const Color(0xFFF5F7FA),
          appBar: AppBar(
            title: const Text('Semitrax'),
            centerTitle: false,
          ),
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 8),
                  _buildCurrentTripCard(
                    destination: nav.currentDestinationName,
                    eta: nav.etaText,
                    milesLeft: nav.milesLeftText,
                    navigationActive: nav.navigationActive,
                    onResume: nav.navigationActive ? onOpenMapTab : () {},
                  ),
                  _buildStatusRow(
                    hosText: nav.hosText,
                    fuelText: nav.fuelPercentText,
                    rangeText: nav.fuelRangeText,
                  ),
                  _buildQuickActions(
                    onNewTrip: onOpenMapTab,
                    onSavedTrips: () {},
                    onDocuments: () {},
                    onFavorites: () {},
                  ),
                  _buildRecentTripsCard(nav.recentTrips),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _dashboardCard({
    required String title,
    required Widget child,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget _buildCurrentTripCard({
    required String destination,
    required String eta,
    required String milesLeft,
    required bool navigationActive,
    required VoidCallback onResume,
  }) {
    return _dashboardCard(
      title: 'Current Trip',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            destination,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text('ETA: $eta'),
          Text('Miles left: $milesLeft'),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: navigationActive ? onResume : null,
              child: Text(
                  navigationActive ? 'Resume Navigation' : 'No Active Trip'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusRow({
    required String hosText,
    required String fuelText,
    required String rangeText,
  }) {
    return Row(
      children: [
        Expanded(
          child: _dashboardCard(
            title: 'HOS',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hosText,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                const Text('Driving since break'),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _dashboardCard(
            title: 'Fuel',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  fuelText,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text('Range: $rangeText'),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickActions({
    required VoidCallback onNewTrip,
    required VoidCallback onSavedTrips,
    required VoidCallback onDocuments,
    required VoidCallback onFavorites,
  }) {
    return _dashboardCard(
      title: 'Quick Actions',
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          ElevatedButton.icon(
            onPressed: onNewTrip,
            icon: const Icon(Icons.search),
            label: const Text('New Trip'),
          ),
          ElevatedButton.icon(
            onPressed: onSavedTrips,
            icon: const Icon(Icons.bookmark),
            label: const Text('Saved Trips'),
          ),
          ElevatedButton.icon(
            onPressed: onDocuments,
            icon: const Icon(Icons.description),
            label: const Text('Documents'),
          ),
          ElevatedButton.icon(
            onPressed: onFavorites,
            icon: const Icon(Icons.star),
            label: const Text('Favorites'),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentTripsCard(List<String> trips) {
    return _dashboardCard(
      title: 'Recent Trips',
      child: trips.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No recent trips yet.',
                style: TextStyle(color: Colors.grey),
              ),
            )
          : Column(
              children: trips.map((trip) {
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.history),
                  title: Text(trip),
                  trailing: const Icon(Icons.chevron_right),
                );
              }).toList(),
            ),
    );
  }
}
