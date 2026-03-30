import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// ─── Dashboard Card ────────────────────────────────────────────────────────────

class DashboardCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  const DashboardCard({super.key, required this.child, this.padding});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: padding ?? const EdgeInsets.all(16),
        child: child,
      ),
    );
  }
}

// ─── Section Header ─────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color? iconColor;
  const _SectionHeader({required this.title, required this.icon, this.iconColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: iconColor ?? Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}

// ─── Current Trip Card ───────────────────────────────────────────────────────

class _CurrentTripCard extends StatelessWidget {
  const _CurrentTripCard();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DashboardCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(title: 'Current Trip', icon: Icons.navigation),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _TripStat(
                  label: 'Destination',
                  value: 'Chicago, IL',
                  icon: Icons.location_on,
                  iconColor: cs.error,
                ),
              ),
              Expanded(
                child: _TripStat(
                  label: 'ETA',
                  value: '4h 22m',
                  icon: Icons.access_time,
                  iconColor: cs.primary,
                ),
              ),
              Expanded(
                child: _TripStat(
                  label: 'Miles Left',
                  value: '312 mi',
                  icon: Icons.straighten,
                  iconColor: Colors.green,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => context.go('/navigation'),
              icon: const Icon(Icons.map),
              label: const Text('Resume Navigation'),
            ),
          ),
        ],
      ),
    );
  }
}

class _TripStat extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? iconColor;
  const _TripStat({required this.label, required this.value, required this.icon, this.iconColor});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, color: iconColor, size: 22),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

// ─── HOS Clock Card ──────────────────────────────────────────────────────────

class _HosClockCard extends StatefulWidget {
  const _HosClockCard();

  @override
  State<_HosClockCard> createState() => _HosClockCardState();
}

class _HosClockCardState extends State<_HosClockCard> {
  late Timer _timer;
  // Demo: driver has been on duty 6h 14m; 11-hour driving limit
  int _driveSecondsUsed = 6 * 3600 + 14 * 60;
  static const int _driveLimit = 11 * 3600;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _driveSecondsUsed++);
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  String _fmt(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final remaining = (_driveLimit - _driveSecondsUsed).clamp(0, _driveLimit);
    final progress = _driveSecondsUsed / _driveLimit;
    final isWarning = remaining < 2 * 3600;
    final cs = Theme.of(context).colorScheme;
    final barColor = isWarning ? cs.error : Colors.green;

    return DashboardCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(title: 'HOS Clock', icon: Icons.timer),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Drive time used', style: Theme.of(context).textTheme.labelSmall),
                    Text(
                      _fmt(_driveSecondsUsed),
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: isWarning ? cs.error : null,
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Remaining', style: Theme.of(context).textTheme.labelSmall),
                    Text(
                      _fmt(remaining),
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              minHeight: 10,
              backgroundColor: barColor.withAlpha(51),
              valueColor: AlwaysStoppedAnimation<Color>(barColor),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('11-Hour Limit', style: Theme.of(context).textTheme.labelSmall),
              if (isWarning)
                Text(
                  'Break required soon!',
                  style: TextStyle(color: cs.error, fontWeight: FontWeight.w600, fontSize: 11),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─── Fuel & Range Card ───────────────────────────────────────────────────────

class _FuelRangeCard extends StatelessWidget {
  const _FuelRangeCard();

  @override
  Widget build(BuildContext context) {
    const fuelPercent = 0.62;
    const truckRangeMi = 430;
    final cs = Theme.of(context).colorScheme;

    return DashboardCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(title: 'Fuel & Range', icon: Icons.local_gas_station, iconColor: Colors.orange),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Fuel Level', style: Theme.of(context).textTheme.labelSmall),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: fuelPercent,
                        minHeight: 14,
                        backgroundColor: cs.surfaceContainerHighest,
                        valueColor: const AlwaysStoppedAnimation<Color>(Colors.orange),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text('${(fuelPercent * 100).round()}% full', style: const TextStyle(fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              const SizedBox(width: 24),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Est. Range', style: Theme.of(context).textTheme.labelSmall),
                  Text(
                    '$truckRangeMi mi',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => context.go('/fuel'),
            icon: const Icon(Icons.search, size: 16),
            label: const Text('Find Nearby Fuel'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(double.infinity, 36)),
          ),
        ],
      ),
    );
  }
}

// ─── Quick Actions Card ──────────────────────────────────────────────────────

class _QuickActionsCard extends StatelessWidget {
  const _QuickActionsCard();

  @override
  Widget build(BuildContext context) {
    final actions = [
      _QuickAction(icon: Icons.add_road, label: 'New Trip', color: Colors.blue, route: '/trip-planner'),
      _QuickAction(icon: Icons.bookmark, label: 'Saved Trips', color: Colors.purple, route: '/trip-planner'),
      _QuickAction(icon: Icons.description, label: 'Documents', color: Colors.teal, route: '/documents'),
      _QuickAction(icon: Icons.star, label: 'Favorites', color: Colors.amber, route: '/poi'),
    ];

    return DashboardCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(title: 'Quick Actions', icon: Icons.bolt),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: actions
                .map((a) => _QuickActionButton(action: a))
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _QuickAction {
  final IconData icon;
  final String label;
  final Color color;
  final String route;
  const _QuickAction({required this.icon, required this.label, required this.color, required this.route});
}

class _QuickActionButton extends StatelessWidget {
  final _QuickAction action;
  const _QuickActionButton({required this.action});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.go(action.route),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: action.color.withAlpha(26),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(action.icon, color: action.color, size: 28),
          ),
          const SizedBox(height: 6),
          Text(action.label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

// ─── Recent Trips Card ───────────────────────────────────────────────────────

class _RecentTripsCard extends StatelessWidget {
  const _RecentTripsCard();

  static const _trips = [
    (origin: 'Portland, OR', dest: 'Reno, NV', date: 'Mar 28', miles: '702 mi'),
    (origin: 'Reno, NV', dest: 'Sacramento, CA', date: 'Mar 25', miles: '134 mi'),
    (origin: 'Sacramento, CA', dest: 'Los Angeles, CA', date: 'Mar 22', miles: '385 mi'),
  ];

  @override
  Widget build(BuildContext context) {
    return DashboardCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const _SectionHeader(title: 'Recent Trips', icon: Icons.history),
              TextButton(
                onPressed: () => context.go('/trip-planner'),
                child: const Text('See all'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ..._trips.map((t) => _RecentTripRow(trip: t)),
        ],
      ),
    );
  }
}

class _RecentTripRow extends StatelessWidget {
  final ({String origin, String dest, String date, String miles}) trip;
  const _RecentTripRow({required this.trip});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          const Icon(Icons.route, size: 18, color: Colors.grey),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${trip.origin} → ${trip.dest}',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
                Text(
                  '${trip.date}  •  ${trip.miles}',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, size: 18, color: Colors.grey),
        ],
      ),
    );
  }
}

// ─── Favorite Stops Card ─────────────────────────────────────────────────────

class _FavoriteStopsCard extends StatelessWidget {
  const _FavoriteStopsCard();

  static const _stops = [
    (name: 'Pilot Travel Center – Boise', type: 'Fuel • DEF • Shower', icon: Icons.local_gas_station),
    (name: 'Love\'s – Ontario, OR', type: 'Fuel • Parking • Shower', icon: Icons.local_gas_station),
    (name: 'TA – Elko, NV', type: 'Fuel • Restaurant • Scales', icon: Icons.local_gas_station),
    (name: 'WinCo DC – Modesto, CA', type: 'Shipper • Appt required', icon: Icons.warehouse),
  ];

  @override
  Widget build(BuildContext context) {
    return DashboardCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const _SectionHeader(title: 'Favorite Stops', icon: Icons.star, iconColor: Colors.amber),
              TextButton(
                onPressed: () => context.go('/poi'),
                child: const Text('Manage'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ..._stops.map((s) => _FavoriteStopRow(stop: s)),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}

class _FavoriteStopRow extends StatelessWidget {
  final ({String name, String type, IconData icon}) stop;
  const _FavoriteStopRow({required this.stop});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: Colors.amber.withAlpha(26),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(stop.icon, color: Colors.amber.shade700, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(stop.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text(stop.type, style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, size: 18, color: Colors.grey),
        ],
      ),
    );
  }
}

// ─── Driver Dashboard Screen ─────────────────────────────────────────────────

class DriverDashboardScreen extends StatelessWidget {
  const DriverDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 24),
      children: const [
        _CurrentTripCard(),
        _HosClockCard(),
        _FuelRangeCard(),
        _QuickActionsCard(),
        _RecentTripsCard(),
        _FavoriteStopsCard(),
      ],
    );
  }
}
