import 'package:flutter/material.dart';
import '../../core/widgets.dart';
import 'package:semitrack_mobile/models/state_province.dart';
import 'package:semitrack_mobile/services/state_province_service.dart';

class TripPlannerScreen extends StatefulWidget {
  const TripPlannerScreen({super.key});

  @override
  State<TripPlannerScreen> createState() => _TripPlannerScreenState();
}

class _TripPlannerScreenState extends State<TripPlannerScreen> {
  final origin = TextEditingController(text: 'Portland, OR');
  final destination = TextEditingController(text: 'Reno, NV');
  final stopA = TextEditingController(text: 'Boise, ID');

  List<StateProvince> _allRegions = [];
  StateProvince? _originState;
  StateProvince? _destinationState;

  @override
  void initState() {
    super.initState();
    _loadRegions();
  }

  Future<void> _loadRegions() async {
    final regions = await StateProvinceService.load();
    if (mounted) {
      setState(() {
        _allRegions = regions;
        // Pre-select OR and NV to match the default text controllers.
        _originState = StateProvinceService.findByCode(regions, 'OR');
        _destinationState = StateProvinceService.findByCode(regions, 'NV');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        TextField(controller: origin, decoration: const InputDecoration(labelText: 'Origin')),
        const SizedBox(height: 8),
        _StateDropdown(
          label: 'Origin State / Province',
          regions: _allRegions,
          selected: _originState,
          onChanged: (s) => setState(() => _originState = s),
        ),
        const SizedBox(height: 12),
        TextField(controller: stopA, decoration: const InputDecoration(labelText: 'Via stop')),
        const SizedBox(height: 12),
        TextField(controller: destination, decoration: const InputDecoration(labelText: 'Destination')),
        const SizedBox(height: 8),
        _StateDropdown(
          label: 'Destination State / Province',
          regions: _allRegions,
          selected: _destinationState,
          onChanged: (s) => setState(() => _destinationState = s),
        ),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: () {}, child: const Text('Build Trip')),
        if (_originState != null || _destinationState != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _RegionInfoCard(
              origin: _originState,
              destination: _destinationState,
            ),
          ),
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

/// Dropdown that lists all loaded [StateProvince] entries.
class _StateDropdown extends StatelessWidget {
  final String label;
  final List<StateProvince> regions;
  final StateProvince? selected;
  final ValueChanged<StateProvince?> onChanged;

  const _StateDropdown({
    required this.label,
    required this.regions,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (regions.isEmpty) {
      return const SizedBox.shrink();
    }
    return DropdownButtonFormField<StateProvince>(
      decoration: InputDecoration(labelText: label),
      value: selected,
      isExpanded: true,
      items: regions
          .map(
            (s) => DropdownMenuItem<StateProvince>(
              value: s,
              child: Text(s.label),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

/// Small info card showing key facts about the selected origin / destination
/// states sourced from the *welcome states pack* JSON data.
class _RegionInfoCard extends StatelessWidget {
  final StateProvince? origin;
  final StateProvince? destination;

  const _RegionInfoCard({this.origin, this.destination});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Region Info',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            if (origin != null) ...[
              Text('Origin: ${origin!.name}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('Capital: ${origin!.capital}  •  Pop: ${origin!.population}'),
              Text('Industry: ${origin!.specialization}'),
              const SizedBox(height: 8),
            ],
            if (destination != null) ...[
              Text('Destination: ${destination!.name}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('Capital: ${destination!.capital}  •  Pop: ${destination!.population}'),
              Text('Industry: ${destination!.specialization}'),
            ],
          ],
        ),
      ),
    );
  }
}
