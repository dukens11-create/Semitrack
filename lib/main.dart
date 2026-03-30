import 'package:flutter/material.dart';
import 'app.dart';
import 'services/settings_controller.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settingsController = SettingsController();
  await settingsController.load();
  runApp(SemitrackApp(settingsController: settingsController));
}
