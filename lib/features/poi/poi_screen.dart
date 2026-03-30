import 'package:flutter/material.dart';

class PoiScreen extends StatelessWidget {
  const PoiScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const fuelStops = [
      _PoiItem('Pilot Travel Center', 'Showers • Parking • Diesel • Food',
          Icons.local_gas_station, Colors.blue),
      _PoiItem("Love's Travel Stop", 'Laundry • DEF • Parking',
          Icons.local_gas_station, Colors.blue),
      _PoiItem('TA Truck Service', 'Repair • Parking • Fuel',
          Icons.local_gas_station, Colors.blue),
    ];

    const restAreas = [
      _PoiItem('Rest Area – I-5 North', 'Parking • Restrooms',
          Icons.airline_seat_recline_normal, Colors.green),
      _PoiItem('Walmart Overnight', 'Parking possibility',
          Icons.local_parking, Colors.green),
    ];

    const regulatory = [
      _PoiItem('Weigh Station', 'Open – I-5 Southbound, OR',
          Icons.monitor_weight_outlined, Colors.orange),
      _PoiItem('Weigh Station', 'Closed – I-5 Southbound, CA',
          Icons.monitor_weight_outlined, Colors.orange),
      _PoiItem('Port of Entry', 'Open – CA/OR Border',
          Icons.flag_outlined, Colors.red),
      _PoiItem('Port of Entry', 'Open – CA/NV Border',
          Icons.flag_outlined, Colors.red),
      _PoiItem('Inspection Site', 'Status Unknown – I-5, OR',
          Icons.search, Colors.deepPurple),
    ];

    return ListView(
      children: [
        const Padding(
          padding: EdgeInsets.all(12),
          child: SearchBar(
              hintText:
                  'Search nearby truck stops, weigh stations, ports of entry'),
        ),
        _sectionHeader(context, 'Fuel Stops & Truck Services'),
        for (final item in fuelStops) _buildCard(item),
        _sectionHeader(context, 'Rest Areas'),
        for (final item in restAreas) _buildCard(item),
        _sectionHeader(context, 'Weigh Stations & Ports of Entry'),
        for (final item in regulatory) _buildCard(item),
      ],
    );
  }

  Widget _sectionHeader(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.bold, color: Colors.grey[700]),
      ),
    );
  }

  Widget _buildCard(_PoiItem item) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: item.color.withOpacity(0.12),
          child: Icon(item.icon, color: item.color, size: 20),
        ),
        title: Text(item.name),
        subtitle: Text(item.subtitle),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

class _PoiItem {
  const _PoiItem(this.name, this.subtitle, this.icon, this.color);
  final String name;
  final String subtitle;
  final IconData icon;
  final Color color;
}
