import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/copilot_device_license.dart';

class CoPilotDeviceSetupScreen extends StatefulWidget {
  const CoPilotDeviceSetupScreen({super.key});

  @override
  State<CoPilotDeviceSetupScreen> createState() => _CoPilotDeviceSetupScreenState();
}

class _CoPilotDeviceSetupScreenState extends State<CoPilotDeviceSetupScreen> {
  static const _storage = FlutterSecureStorage();
  static const _companyKey = 'copilot.company_id';
  static const _assetKey = 'copilot.asset_id';
  final _company = TextEditingController();
  final _asset = TextEditingController();
  bool _busy = true;
  String? _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final company = await _storage.read(key: _companyKey);
      final asset = await _storage.read(key: _assetKey);
      if (!mounted) return;
      _company.text = company ?? '';
      _asset.text = asset ?? '';
    } catch (_) {
      if (mounted) _message = 'Could not read saved device settings. Please retry.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _activate() async {
    setState(() { _busy = true; _message = null; });
    try {
      final license = CoPilotDeviceLicense(
        companyId: _company.text, assetId: _asset.text,
      );
      await _storage.write(key: _companyKey, value: license.companyId);
      await _storage.write(key: _assetKey, value: license.assetId);
      final opened = await launchUrl(
        license.activationUri, mode: LaunchMode.externalApplication,
      );
      if (!mounted) return;
      setState(() => _message = opened
          ? 'CoPilot opened. Complete activation there. Opening the app does not confirm license activation.'
          : 'CoPilot could not open. Install CoPilot GPS on this device, then retry.');
    } on FormatException catch (error) {
      if (mounted) setState(() => _message = error.message.toString());
    } catch (_) {
      if (mounted) setState(() => _message =
          'Could not save settings or open CoPilot. Check that CoPilot GPS is installed, then retry.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _company.dispose();
    _asset.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('CoPilot device setup')),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Activate the CoPilot Truck license assigned to this device.'),
      const SizedBox(height: 12),
      const Text('Install CoPilot GPS first. Use the company and device IDs from Trimble Account Manager. Each device needs its own assigned license.'),
      const SizedBox(height: 20),
      TextField(controller: _company, enabled: !_busy,
        autocorrect: false, enableSuggestions: false,
        decoration: const InputDecoration(labelText: 'Company ID')),
      const SizedBox(height: 12),
      TextField(controller: _asset, enabled: !_busy,
        autocorrect: false, enableSuggestions: false,
        decoration: const InputDecoration(labelText: 'Device ID')),
      const SizedBox(height: 20),
      FilledButton(onPressed: _busy ? null : _activate,
        child: Text(_busy ? 'Please wait…' : 'Open CoPilot to activate')),
      if (_message != null) Padding(padding: const EdgeInsets.only(top: 16),
        child: Text(_message!, semanticsLabel: _message)),
      const SizedBox(height: 20),
      const Text('After activation, check for Activated in Trimble Account Manager. This setup opens the separate CoPilot app.'),
    ]),
  );
}
