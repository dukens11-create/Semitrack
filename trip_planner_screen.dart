import 'package:flutter/material.dart';
import '../../core/widgets.dart';

class TripPlannerScreen extends StatefulWidget {
  const TripPlannerScreen({super.key});

  @override
  State<TripPlannerScreen> createState() => _TripPlannerScreenState();
}

class _TripPlannerScreenState extends State<TripPlannerScreen> {
  final origin = TextEditingController(text: 'Portland, OR');
  final destination = TextEditingController(text: 'Reno, NV');
  final stopA = TextEditingController(text: 'Boise, ID');

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: origin, decoration: const InputDecoration(labelText: 'Origin')),
        const SizedBox(height: 12),
        TextField(controller: stopA, decoration: const InputDecoration(labelText: 'Via stop')),
        const SizedBox(height: 12),
        TextField(controller: destination, decoration: const InputDecoration(labelText: 'Destination')),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: () {}, child: const Text('Build Trip')),
        const SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Trip Preview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              SizedBox(height: 12),
              LabelValue(label: 'Distance', value: '702 mi'),
              LabelValue(label: 'ETA', value: '12h 50m'),
              LabelValue(label: 'HOS break', value: '30 min after 8 hours'),
              LabelValue(label: 'Fuel plan', value: '2 truck-safe stops'),
              LabelValue(label: 'Alternative routes', value: '2'),
              LabelValue(label: 'Saved trip', value: 'Yes'),
            ],
          ),
        ),
      ],
    );
  }
}
