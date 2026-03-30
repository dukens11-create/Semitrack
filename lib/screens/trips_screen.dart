import 'package:flutter/material.dart';

import '../models/trip.dart';
import '../services/trip_storage.dart';

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  List<Trip> _trips = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadTrips();
  }

  Future<void> _loadTrips() async {
    final data = await TripStorage.loadTrips();
    if (mounted) {
      setState(() {
        _trips = data;
        _loading = false;
      });
    }
  }

  Future<void> _deleteTrip(String id) async {
    setState(() => _trips.removeWhere((t) => t.id == id));
    await TripStorage.deleteTrip(id);
  }

  void _openTrip(Trip trip) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Open trip: ${trip.destinationName}')),
    );
  }

  String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }

  String _formatDate(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
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
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadTrips,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildPlannerCard(context),
                  const SizedBox(height: 20),
                  _buildSectionTitle('Trip History'),
                  const SizedBox(height: 8),
                  if (_trips.isEmpty)
                    _buildEmptyCard('No trips yet — complete a navigation to save one')
                  else
                    ..._trips.map(
                      (trip) => _buildTripCard(
                        trip: trip,
                        onOpen: () => _openTrip(trip),
                        onDelete: () => _deleteTrip(trip.id),
                      ),
                    ),
                  const SizedBox(height: 80),
                ],
              ),
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
    required Trip trip,
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
          trip.destinationName,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            '${trip.distanceMiles.toStringAsFixed(0)} mi'
            ' • ${_formatDuration(trip.duration)}'
            '\n${_formatDate(trip.completedAt)}',
          ),
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
