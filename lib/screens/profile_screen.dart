import 'package:flutter/material.dart';

import '../models/truck_profile.dart';
import '../services/auth_service.dart';
import '../services/truck_profile_service.dart';
import 'offline_maps_screen.dart';
import 'eld_connections_screen.dart';
import 'subscription_plans_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.auth});
  final AuthService auth;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TruckProfileService profiles;

  @override
  void initState() {
    super.initState();
    profiles = TruckProfileService(widget.auth.api)..load();
  }

  @override
  void dispose() {
    profiles.dispose();
    super.dispose();
  }

  Future<void> _edit([TruckProfile? profile]) async {
    final updated = await showDialog<TruckProfile>(
      context: context,
      builder: (context) => _TruckProfileDialog(profile: profile),
    );
    if (updated == null) return;
    try {
      await profiles.save(updated);
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _delete(TruckProfile profile) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete ${profile.name}?'),
        content: const Text(
          'This truck profile will be removed from your account.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await profiles.delete(profile.id);
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('More'),
        actions: [
          IconButton(
            onPressed: widget.auth.logout,
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Sign out',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add truck'),
      ),
      body: AnimatedBuilder(
        animation: profiles,
        builder: (context, _) {
          if (profiles.loading && profiles.profiles.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }
          return RefreshIndicator(
            onRefresh: profiles.load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              children: [
                Card(
                  child: ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.person_rounded),
                    ),
                    title: Text(widget.auth.user?.fullName ?? ''),
                    subtitle: Text(
                      '${widget.auth.user?.email ?? ''} • ${widget.auth.user?.plan ?? 'FREE'}',
                    ),
                  ),
                ),
                Card(
                  clipBehavior: Clip.antiAlias,
                  child: DecoratedBox(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFF102638), Color(0xFF291B18)],
                      ),
                    ),
                    child: ListTile(
                      leading: const CircleAvatar(
                        backgroundColor: Color(0xFFFF6B2C),
                        foregroundColor: Colors.white,
                        child: Icon(Icons.workspace_premium_rounded),
                      ),
                      title: const Text(
                        'SemiTraX Premium',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: const Text(
                        'View current trial, monthly, annual, and fleet plans',
                        style: TextStyle(color: Color(0xFFC4D0D8)),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: Color(0xFFFF6B2C),
                      ),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) =>
                              SubscriptionPlansScreen(api: widget.auth.api),
                        ),
                      ),
                    ),
                  ),
                ),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.cable_rounded),
                    title: const Text('ELD connections'),
                    subtitle: const Text(
                      'Connect Samsara or Motive and sync HOS',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            EldConnectionsScreen(api: widget.auth.api),
                      ),
                    ),
                  ),
                ),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.map_rounded),
                    title: const Text('Offline maps'),
                    subtitle: const Text(
                      'Download, inspect, and remove map regions',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const OfflineMapsScreen(),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Truck profiles',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                if (profiles.error != null)
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: ListTile(
                      leading: const Icon(Icons.cloud_off),
                      title: const Text('Could not sync truck profiles'),
                      subtitle: Text(profiles.error!),
                      trailing: IconButton(
                        onPressed: profiles.load,
                        icon: const Icon(Icons.refresh),
                      ),
                    ),
                  ),
                if (!profiles.loading && profiles.profiles.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'Add a truck profile before calculating a commercial route.',
                      ),
                    ),
                  ),
                for (final profile in profiles.profiles)
                  Card(
                    child: ListTile(
                      leading: Icon(
                        profile.isDefault
                            ? Icons.local_shipping
                            : Icons.local_shipping_outlined,
                      ),
                      title: Text(profile.name),
                      subtitle: Text(
                        '${profile.heightFt.toStringAsFixed(1)} ft H • '
                        '${profile.widthFt.toStringAsFixed(1)} ft W • '
                        '${profile.lengthFt.toStringAsFixed(0)} ft L\n'
                        '${profile.weightLbs} lbs • ${profile.axleCount} axles'
                        '${profile.hazmatEnabled ? ' • HAZMAT' : ''}',
                      ),
                      isThreeLine: true,
                      trailing: PopupMenuButton<String>(
                        onSelected: (value) {
                          if (value == 'default') profiles.select(profile.id);
                          if (value == 'edit') _edit(profile);
                          if (value == 'delete') _delete(profile);
                        },
                        itemBuilder: (context) => [
                          if (!profile.isDefault)
                            const PopupMenuItem(
                              value: 'default',
                              child: Text('Set as active'),
                            ),
                          const PopupMenuItem(
                            value: 'edit',
                            child: Text('Edit'),
                          ),
                          const PopupMenuItem(
                            value: 'delete',
                            child: Text('Delete'),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _TruckProfileDialog extends StatefulWidget {
  const _TruckProfileDialog({this.profile});
  final TruckProfile? profile;

  @override
  State<_TruckProfileDialog> createState() => _TruckProfileDialogState();
}

class _TruckProfileDialogState extends State<_TruckProfileDialog> {
  final formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> fields;
  bool hazmat = false;
  bool avoidTolls = false;
  bool avoidFerries = false;
  bool avoidHighways = false;

  @override
  void initState() {
    super.initState();
    final p = widget.profile;
    fields = {
      'name': TextEditingController(text: p?.name ?? ''),
      'height': TextEditingController(text: p?.heightFt.toString() ?? '13.6'),
      'width': TextEditingController(text: p?.widthFt.toString() ?? '8.5'),
      'length': TextEditingController(text: p?.lengthFt.toString() ?? '70'),
      'weight': TextEditingController(text: p?.weightLbs.toString() ?? '80000'),
      'axles': TextEditingController(text: p?.axleCount.toString() ?? '5'),
      'trailers': TextEditingController(
        text: p?.trailerCount.toString() ?? '1',
      ),
      'trailerType': TextEditingController(text: p?.trailerType ?? 'semi'),
      'hazmatClasses': TextEditingController(
        text: p?.hazardousGoods.join(', ') ?? '',
      ),
    };
    hazmat = p?.hazmatEnabled ?? false;
    avoidTolls = p?.avoidTolls ?? false;
    avoidFerries = p?.avoidFerries ?? false;
    avoidHighways = p?.avoidHighways ?? false;
  }

  @override
  void dispose() {
    for (final controller in fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _number(String? value, double min, double max) {
    final number = double.tryParse(value ?? '');
    if (number == null || number < min || number > max)
      return 'Enter a value from $min to $max';
    return null;
  }

  void _save() {
    if (!formKey.currentState!.validate()) return;
    final p = widget.profile;
    final hazardousGoods = fields['hazmatClasses']!.text
        .split(',')
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    if (hazmat && hazardousGoods.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one HAZMAT class.')),
      );
      return;
    }
    Navigator.pop(
      context,
      TruckProfile(
        id: p?.id ?? '',
        name: fields['name']!.text.trim(),
        isDefault: p?.isDefault ?? false,
        heightFt: double.parse(fields['height']!.text),
        widthFt: double.parse(fields['width']!.text),
        lengthFt: double.parse(fields['length']!.text),
        weightLbs: int.parse(fields['weight']!.text),
        axleCount: int.parse(fields['axles']!.text),
        trailerCount: int.parse(fields['trailers']!.text),
        trailerType: fields['trailerType']!.text.trim(),
        hazmatEnabled: hazmat,
        hazardousGoods: hazardousGoods,
        avoidTolls: avoidTolls,
        avoidFerries: avoidFerries,
        avoidHighways: avoidHighways,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration decoration(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder());
    Widget numberField(String key, String label, double min, double max) =>
        TextFormField(
          controller: fields[key],
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: decoration(label),
          validator: (value) => _number(value, min, max),
        );
    return AlertDialog(
      title: Text(
        widget.profile == null ? 'Add truck profile' : 'Edit truck profile',
      ),
      content: SizedBox(
        width: 520,
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              children: [
                TextFormField(
                  controller: fields['name'],
                  decoration: decoration('Profile nickname'),
                  validator: (v) =>
                      (v?.trim().isEmpty ?? true) ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                numberField('height', 'Height (ft)', 4, 20),
                const SizedBox(height: 12),
                numberField('width', 'Width (ft)', 4, 20),
                const SizedBox(height: 12),
                numberField('length', 'Overall length (ft)', 8, 150),
                const SizedBox(height: 12),
                numberField('weight', 'Gross weight (lbs)', 1000, 300000),
                const SizedBox(height: 12),
                numberField('axles', 'Axle count', 2, 20),
                const SizedBox(height: 12),
                numberField('trailers', 'Trailer count', 0, 4),
                const SizedBox(height: 12),
                TextFormField(
                  controller: fields['trailerType'],
                  decoration: decoration('Trailer type'),
                ),
                SwitchListTile(
                  value: hazmat,
                  onChanged: (v) => setState(() => hazmat = v),
                  title: const Text('HAZMAT'),
                ),
                if (hazmat)
                  TextFormField(
                    controller: fields['hazmatClasses'],
                    decoration: decoration('HAZMAT classes (comma separated)'),
                  ),
                SwitchListTile(
                  value: avoidTolls,
                  onChanged: (v) => setState(() => avoidTolls = v),
                  title: const Text('Avoid tolls'),
                ),
                SwitchListTile(
                  value: avoidFerries,
                  onChanged: (v) => setState(() => avoidFerries = v),
                  title: const Text('Avoid ferries'),
                ),
                SwitchListTile(
                  value: avoidHighways,
                  onChanged: (v) => setState(() => avoidHighways = v),
                  title: const Text('Avoid highways'),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }
}
