import 'package:flutter/material.dart';
import '../../core/widgets.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: const [
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Driver Profile', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              SizedBox(height: 12),
              LabelValue(label: 'Name', value: 'Bal Dukens'),
              LabelValue(label: 'Truck height', value: '13.5 ft'),
              LabelValue(label: 'Truck weight', value: '80,000 lbs'),
              LabelValue(label: 'Width', value: '8.5 ft'),
              LabelValue(label: 'Length', value: '72 ft'),
              LabelValue(label: 'Hazmat', value: 'Disabled'),
              LabelValue(label: 'Axles', value: '5'),
              LabelValue(label: 'Route preference', value: 'Truck safe + fuel optimized'),
            ],
          ),
        ),
      ],
    );
  }
}
