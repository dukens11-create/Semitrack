import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../theme/semitrack_theme.dart';
import '../widgets/semitrack_ui.dart';

class DriverDashboardScreen extends StatelessWidget {
  const DriverDashboardScreen({
    super.key,
    required this.user,
    required this.onPlanTrip,
    required this.onTrips,
    required this.onDocuments,
    required this.onProfile,
  });

  final AuthUser? user;
  final VoidCallback onPlanTrip;
  final VoidCallback onTrips;
  final VoidCallback onDocuments;
  final VoidCallback onProfile;

  String get _firstName {
    final name = user?.fullName.trim() ?? '';
    return name.isEmpty ? 'Driver' : name.split(RegExp(r'\s+')).first;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
              sliver: SliverList.list(
                children: [
                  Row(
                    children: [
                      const Expanded(child: SemiTrackWordmark(compact: true)),
                      InkWell(
                        borderRadius: BorderRadius.circular(24),
                        onTap: onProfile,
                        child: CircleAvatar(
                          radius: 22,
                          backgroundColor: SemiTrackColors.orange.withOpacity(
                            0.14,
                          ),
                          child: Text(
                            _firstName.substring(0, 1).toUpperCase(),
                            style: const TextStyle(
                              color: SemiTrackColors.orange,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  Text(
                    'Ready to roll, $_firstName?',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Plan around truck restrictions, stops, and live road conditions.',
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: Theme.of(
                        context,
                      ).colorScheme.onSurface.withOpacity(0.62),
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 20),
                  _RouteHero(onPlanTrip: onPlanTrip),
                  const SizedBox(height: 24),
                  const SemiTrackSectionTitle(
                    title: 'Driver shortcuts',
                    subtitle: 'Everything important stays one tap away',
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _QuickAction(
                          icon: Icons.route_rounded,
                          label: 'Trips',
                          onTap: onTrips,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _QuickAction(
                          icon: Icons.description_rounded,
                          label: 'Documents',
                          onTap: onDocuments,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _QuickAction(
                          icon: Icons.local_shipping_rounded,
                          label: 'My truck',
                          onTap: onProfile,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  const SemiTrackSectionTitle(
                    title: 'Truck-safe by design',
                    subtitle:
                        'SemiTrax never substitutes a passenger-car route',
                  ),
                  const SizedBox(height: 12),
                  const _SafetySummary(),
                  const SizedBox(height: 24),
                  SemiTrackSectionTitle(
                    title: 'Before departure',
                    subtitle: 'Verify the details that control your route',
                    trailing: TextButton(
                      onPressed: onProfile,
                      child: const Text('Review'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  DriverActionTile(
                    icon: Icons.straighten_rounded,
                    label: 'Truck dimensions and weight',
                    caption:
                        'Height, width, length, axles, trailer, and HAZMAT',
                    color: SemiTrackColors.orange,
                    onTap: onProfile,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RouteHero extends StatelessWidget {
  const _RouteHero({required this.onPlanTrip});

  final VoidCallback onPlanTrip;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [SemiTrackColors.navy, Color(0xFF263C52)],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33101820),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const StatusPill(
            label: 'COMMERCIAL TRUCK MODE',
            color: Color(0xFF6FE0B8),
            icon: Icons.verified_user_rounded,
          ),
          const SizedBox(height: 18),
          const Text(
            'Where are you hauling?',
            style: TextStyle(
              color: Colors.white,
              fontSize: 25,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Build a route using your active truck profile.',
            style: TextStyle(color: Colors.white70, height: 1.35),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: onPlanTrip,
              icon: const Icon(Icons.search_rounded),
              label: const Text('Choose destination'),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return DriverCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 15),
      child: Column(
        children: [
          Icon(icon, color: SemiTrackColors.orange, size: 28),
          const SizedBox(height: 8),
          Text(
            label,
            maxLines: 1,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _SafetySummary extends StatelessWidget {
  const _SafetySummary();

  @override
  Widget build(BuildContext context) {
    return const DriverCard(
      child: Column(
        children: [
          _SafetyRow(
            icon: Icons.height_rounded,
            title: 'Clearance and size restrictions',
          ),
          Divider(height: 22),
          _SafetyRow(
            icon: Icons.scale_rounded,
            title: 'Weight, axle, and prohibited roads',
          ),
          Divider(height: 22),
          _SafetyRow(
            icon: Icons.warning_amber_rounded,
            title: 'Road alerts, grades, and live DOT data',
          ),
        ],
      ),
    );
  }
}

class _SafetyRow extends StatelessWidget {
  const _SafetyRow({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: SemiTrackColors.green, size: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        const Icon(
          Icons.check_circle_rounded,
          color: SemiTrackColors.green,
          size: 20,
        ),
      ],
    );
  }
}
