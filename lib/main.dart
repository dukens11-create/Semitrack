import 'package:flutter/material.dart';
import 'screens/app_shell.dart';
import 'services/settings_controller.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settingsController = SettingsController();
  await settingsController.load();
  runApp(SemitraxApp(settingsController: settingsController));
}

class SemitraxApp extends StatefulWidget {
  const SemitraxApp({super.key, required this.settingsController});

  final SettingsController settingsController;

  @override
  State<SemitraxApp> createState() => _SemitraxAppState();
}

class _SemitraxAppState extends State<SemitraxApp> {
  @override
  void initState() {
    super.initState();
    widget.settingsController.addListener(_onSettingsChanged);
  }

  @override
  void dispose() {
    widget.settingsController.removeListener(_onSettingsChanged);
    super.dispose();
  }

  void _onSettingsChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final isDark = widget.settingsController.settings.darkMode;
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Semitrax',
      themeMode: isDark ? ThemeMode.dark : ThemeMode.light,
      theme: ThemeData.light(useMaterial3: true),
      darkTheme: ThemeData.dark(useMaterial3: true),
      home: AppShell(settingsController: widget.settingsController),
    );
  }
}
