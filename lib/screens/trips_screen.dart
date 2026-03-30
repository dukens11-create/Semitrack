import 'package:flutter/material.dart';

class SavedTrip {
  final String id;
  final String title;
  final String destinationName;
  final String subtitle;

  const SavedTrip({
    required this.id,
    required this.title,
    required this.destinationName,
    required this.subtitle,
  });
}

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  final List<SavedTrip> _savedTrips = [
    const SavedTrip(
      id: '1',
      title: 'Portland to Sacramento',
      destinationName: 'Sacramento, CA',
      subtitle: '533 mi • Fastest Route',
    ),
    const SavedTrip(
      id: '2',
      title: 'Reno to Fresno',
      destinationName: 'Fresno, CA',
      subtitle: '267 mi • Truck Safe',
    ),
  ];

  final List<SavedTrip> _recentTrips = [
    const SavedTrip(
      id: '3',
      title: 'Seattle to Eugene',
      destinationName: 'Eugene, OR',
      subtitle: '283 mi • Recent',
    ),
    const SavedTrip(
      id: '4',
      title: 'Medford to Portland',
      destinationName: 'Portland, OR',
      subtitle: '273 mi • Recent',
    ),
  ];

  void _openTrip(SavedTrip trip) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Open trip: ${trip.title}')),
    );
  }

  void _deleteSavedTrip(String id) {
    setState(() {
      _savedTrips.removeWhere((trip) => trip.id == id);
    });
  }

  void _deleteRecentTrip(String id) {
    setState(() {
      _recentTrips.removeWhere((trip) => trip.id == id);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Trips')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Open trip planner')),
          );
        },
        icon: const Icon(Icons.add_road),
        label: const Text('New Trip'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildPlannerCard(context),
          const SizedBox(height: 20),
          _buildSectionTitle('Saved Trips'),
          const SizedBox(height: 8),
          if (_savedTrips.isEmpty)
            _buildEmptyCard('No saved trips yet')
          else
            ..._savedTrips.map(
              (trip) => _buildTripCard(
                trip: trip,
                onOpen: () => _openTrip(trip),
                onDelete: () => _deleteSavedTrip(trip.id),
              ),
            ),
          const SizedBox(height: 20),
          _buildSectionTitle('Recent Trips'),
          const SizedBox(height: 8),
          if (_recentTrips.isEmpty)
            _buildEmptyCard('No recent trips yet')
          else
            ..._recentTrips.map(
              (trip) => _buildTripCard(
                trip: trip,
                onOpen: () => _openTrip(trip),
                onDelete: () => _deleteRecentTrip(trip.id),
              ),
            ),
          const SizedBox(height: 80),
        ],
      ),
    );
  }

  Widget _buildPlannerCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Multi-stop Planner',
            style: TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Build A → B → C routes, reorder stops, and plan the full trip.',
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Open trip planner')),
              );
            },
            child: const Text('Open Planner'),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String text) {
    return Text(
      text,
      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
    );
  }

  Widget _buildEmptyCard(String text) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 15, color: Colors.grey),
      ),
    );
  }

  Widget _buildTripCard({
    required SavedTrip trip,
    required VoidCallback onOpen,
    required VoidCallback onDelete,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        leading: const CircleAvatar(child: Icon(Icons.route)),
        title: Text(
          trip.title,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('${trip.destinationName}\n${trip.subtitle}'),
        ),
        isThreeLine: true,
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            if (value == 'open') onOpen();
            if (value == 'delete') onDelete();
          },
          itemBuilder: (context) => const [
            PopupMenuItem(value: 'open', child: Text('Open')),
            PopupMenuItem(value: 'delete', child: Text('Delete')),
          ],
        ),
        onTap: onOpen,
      ),
    );
  }
}
