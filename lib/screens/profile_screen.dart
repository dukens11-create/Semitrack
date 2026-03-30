import 'package:flutter/material.dart';
import '../models/app_settings.dart';
import '../services/settings_controller.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.settingsController});

  final SettingsController settingsController;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _truckHeightController;
  late final TextEditingController _truckWeightController;
  late final TextEditingController _truckLengthController;
  late final TextEditingController _fuelTankController;
  late final TextEditingController _mpgController;

  late bool _avoidTolls;
  late bool _avoidFerries;
  late bool _preferTruckSafe;
  late bool _darkMode;
  late bool _voiceNavigation;

  @override
  void initState() {
    super.initState();
    final s = widget.settingsController.settings;
    _truckHeightController =
        TextEditingController(text: s.truckHeightFt.toString());
    _truckWeightController =
        TextEditingController(text: s.truckWeightLb.toString());
    _truckLengthController =
        TextEditingController(text: s.truckLengthFt.toString());
    _fuelTankController =
        TextEditingController(text: s.fuelTankGallons.toString());
    _mpgController = TextEditingController(text: s.avgMpg.toString());
    _avoidTolls = s.avoidTolls;
    _avoidFerries = s.avoidFerries;
    _preferTruckSafe = s.preferTruckSafe;
    _darkMode = s.darkMode;
    _voiceNavigation = s.voiceNavigation;
  }

  @override
  void dispose() {
    _truckHeightController.dispose();
    _truckWeightController.dispose();
    _truckLengthController.dispose();
    _fuelTankController.dispose();
    _mpgController.dispose();
    super.dispose();
  }

  void _saveProfile() {
    final cur = widget.settingsController.settings;
    final newSettings = AppSettings(
      truckHeightFt:
          double.tryParse(_truckHeightController.text) ?? cur.truckHeightFt,
      truckWeightLb:
          double.tryParse(_truckWeightController.text) ?? cur.truckWeightLb,
      truckLengthFt:
          double.tryParse(_truckLengthController.text) ?? cur.truckLengthFt,
      fuelTankGallons:
          double.tryParse(_fuelTankController.text) ?? cur.fuelTankGallons,
      avgMpg: double.tryParse(_mpgController.text) ?? cur.avgMpg,
      avoidTolls: _avoidTolls,
      avoidFerries: _avoidFerries,
      preferTruckSafe: _preferTruckSafe,
      voiceNavigation: _voiceNavigation,
      darkMode: _darkMode,
    );
    widget.settingsController.update(newSettings);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Profile settings saved')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildTopCard(),
          const SizedBox(height: 16),
          _buildSectionTitle('Truck Specs'),
          const SizedBox(height: 8),
          _buildInputCard(
            child: Column(
              children: [
                _buildTextField(
                  controller: _truckHeightController,
                  label: 'Truck Height (ft)',
                  icon: Icons.height,
                ),
                const SizedBox(height: 12),
                _buildTextField(
                  controller: _truckWeightController,
                  label: 'Truck Weight (lb)',
                  icon: Icons.scale,
                ),
                const SizedBox(height: 12),
                _buildTextField(
                  controller: _truckLengthController,
                  label: 'Truck Length (ft)',
                  icon: Icons.straighten,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _buildSectionTitle('Fuel Settings'),
          const SizedBox(height: 8),
          _buildInputCard(
            child: Column(
              children: [
                _buildTextField(
                  controller: _fuelTankController,
                  label: 'Fuel Tank Size (gal)',
                  icon: Icons.local_gas_station,
                ),
                const SizedBox(height: 12),
                _buildTextField(
                  controller: _mpgController,
                  label: 'Average MPG',
                  icon: Icons.speed,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _buildSectionTitle('Route Preferences'),
          const SizedBox(height: 8),
          _buildSwitchCard(
            children: [
              SwitchListTile(
                value: _avoidTolls,
                title: const Text('Avoid Tolls'),
                onChanged: (v) => setState(() => _avoidTolls = v),
              ),
              SwitchListTile(
                value: _avoidFerries,
                title: const Text('Avoid Ferries'),
                onChanged: (v) => setState(() => _avoidFerries = v),
              ),
              SwitchListTile(
                value: _preferTruckSafe,
                title: const Text('Prefer Truck Safe Routes'),
                onChanged: (v) => setState(() => _preferTruckSafe = v),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildSectionTitle('App Settings'),
          const SizedBox(height: 8),
          _buildSwitchCard(
            children: [
              SwitchListTile(
                value: _voiceNavigation,
                title: const Text('Voice Navigation'),
                onChanged: (v) => setState(() => _voiceNavigation = v),
              ),
              SwitchListTile(
                value: _darkMode,
                title: const Text('Dark Mode'),
                onChanged: (v) => setState(() => _darkMode = v),
              ),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _saveProfile,
              child: const Text('Save Settings'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Driver & Truck Settings',
            style: TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(height: 8),
          Text(
            'Set your truck dimensions, fuel data, and route preferences for safer navigation.',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  Widget _buildInputCard({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: child,
    );
  }

  Widget _buildSwitchCard({required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: Column(children: children),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
  }) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    );
  }
}
