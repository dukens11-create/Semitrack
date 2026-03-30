import 'package:flutter/material.dart';
import 'screens/app_shell.dart';
import 'services/navigation_state_controller.dart';

void main() {
  final navigationStateController = NavigationStateController();
  runApp(SemitraxApp(navigationStateController: navigationStateController));
}

class SemitraxApp extends StatelessWidget {
  final NavigationStateController navigationStateController;

  const SemitraxApp({super.key, required this.navigationStateController});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Semitrax',
      home: AppShell(navigationStateController: navigationStateController),
    );
  }
}
