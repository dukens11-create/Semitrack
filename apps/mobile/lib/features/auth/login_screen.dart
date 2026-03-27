import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api_client.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final api = ApiClient();
  final email = TextEditingController(text: 'driver@semitrack.com');
  final password = TextEditingController(text: 'password123');
  String status = '';

  Future<void> login() async {
    final data = await api.post('/auth/login', {
      'email': email.text,
      'password': password.text,
    });

    if (data['token'] != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', data['token']);
      if (!mounted) return;
      context.go('/home');
    } else {
      setState(() => status = 'Login failed');
    }
  }

  Future<void> register() async {
    final data = await api.post('/auth/register', {
      'fullName': 'Driver User',
      'email': email.text,
      'password': password.text,
      'role': 'DRIVER',
    });

    if (data['token'] != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', data['token']);
      if (!mounted) return;
      context.go('/home');
    } else {
      setState(() => status = 'Register failed');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Semitrack Login')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: email,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: password,
              decoration: const InputDecoration(labelText: 'Password'),
              obscureText: true,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: login,
                    child: const Text('Login'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: register,
                    child: const Text('Register'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(status),
          ],
        ),
      ),
    );
  }
}
