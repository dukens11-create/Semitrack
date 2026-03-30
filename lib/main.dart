import 'package:flutter/material.dart';
import 'screens/app_shell.dart';

void main() {
  runApp(const SemitraxApp());
}

class SemitraxApp extends StatelessWidget {
  const SemitraxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Semitrax',
      home: AppShell(),
    );
  }
}
