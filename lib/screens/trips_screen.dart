import 'package:flutter/material.dart';

import '../theme/semitrack_theme.dart';
import '../widgets/semitrack_ui.dart';

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key, required this.onPlanTrip});

  final VoidCallback onPlanTrip;

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  String _filter = 'Planned';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Trips',
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Plan, review, and repeat your truck-safe routes.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(
                            context,
                          ).colorScheme.onSurface.withOpacity(0.62),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton.filled(
                  tooltip: 'Plan a trip',
                  onPressed: widget.onPlanTrip,
                  icon: const Icon(Icons.add_road_rounded),
                ),
              ],
            ),
            const SizedBox(height: 22),
            DriverCard(
              color: SemiTrackColors.navy,
              child: Row(
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Start a new haul',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 5),
                        Text(
                          'Add a destination and optional waypoints on the map.',
                          style: TextStyle(color: Colors.white70, height: 1.35),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    onPressed: widget.onPlanTrip,
                    child: const Text('Plan'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final label in const ['Planned', 'Recent', 'Saved']) ...[
                    ChoiceChip(
                      label: Text(label),
                      selected: _filter == label,
                      onSelected: (_) => setState(() => _filter = label),
                    ),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            DriverEmptyState(
              icon: _filter == 'Saved'
                  ? Icons.bookmark_border_rounded
                  : _filter == 'Recent'
                  ? Icons.history_rounded
                  : Icons.route_rounded,
              title: 'No ${_filter.toLowerCase()} trips',
              message: _filter == 'Planned'
                  ? 'Routes you prepare will be available here before departure.'
                  : _filter == 'Recent'
                  ? 'Completed routes will appear here after navigation.'
                  : 'Save a useful route to make the next haul faster.',
              actionLabel: 'Plan truck route',
              onAction: widget.onPlanTrip,
            ),
          ],
        ),
      ),
    );
  }
}
