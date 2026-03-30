import 'package:flutter/material.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final TextEditingController _truckHeightController =
      TextEditingController(text: '13.6');
  final TextEditingController _truckWeightController =
      TextEditingController(text: '80000');
  final TextEditingController _truckLengthController =
      TextEditingController(text: '72');
  final TextEditingController _fuelTankController =
      TextEditingController(text: '150');
  final TextEditingController _mpgController =
      TextEditingController(text: '6.8');

  bool _avoidTolls = false;
  bool _avoidFerries = true;
  bool _preferTruckSafe = true;
  bool _darkMode = false;
  bool _voiceNavigation = true;

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
