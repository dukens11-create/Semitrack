import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiClient {
  static const baseUrl = 'http://10.0.2.2:4000';

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body, {
    String? token,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode(body),
    );

    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> get(
    String path, {
    String? token,
  }) async {
    final res = await http.get(
      Uri.parse('$baseUrl$path'),
      headers: {
        if (token != null) 'Authorization': 'Bearer $token',
      },
    );

    return jsonDecode(res.body) as Map<String, dynamic>;
  }
}
