import 'package:flutter/foundation.dart';
import 'package:semitrack_mobile/core/api_client.dart';

enum EldProvider { samsara, motive }

extension on EldProvider {
  String get apiName => name.toUpperCase();
}

class EldConnection {
  const EldConnection({
    required this.provider,
    required this.status,
    required this.scopes,
    this.lastSyncedAt,
    this.lastErrorMessage,
  });

  final EldProvider provider;
  final String status;
  final List<String> scopes;
  final DateTime? lastSyncedAt;
  final String? lastErrorMessage;

  factory EldConnection.fromJson(Map<String, dynamic> json) => EldConnection(
        provider: EldProvider.values.firstWhere(
          (provider) => provider.apiName == json['provider'],
        ),
        status: json['status']?.toString() ?? 'DISCONNECTED',
        scopes: (json['scopes'] as List? ?? const [])
            .map((value) => value.toString())
            .toList(growable: false),
        lastSyncedAt: DateTime.tryParse(json['lastSyncedAt']?.toString() ?? ''),
        lastErrorMessage: json['lastErrorMessage']?.toString(),
      );
}

class EldService extends ChangeNotifier {
  EldService(this.api);
  final ApiClient api;

  bool loading = false;
  String? error;
  List<EldConnection> connections = const [];
  Map<String, dynamic>? lastSnapshot;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final response = await api.getJson('/eld/connections');
      connections = (response['items'] as List? ?? const [])
          .map((value) => EldConnection.fromJson(value as Map<String, dynamic>))
          .toList(growable: false);
    } catch (value) {
      error = value.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<Uri> beginConnect(EldProvider provider) async {
    final response = await api.postJson('/eld/${provider.apiName}/connect', {});
    return Uri.parse(response['authorizeUrl'].toString());
  }

  Future<void> sync(EldProvider provider) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      lastSnapshot = await api.postJson('/eld/${provider.apiName}/sync', {});
      await load();
    } catch (value) {
      error = value.toString();
      loading = false;
      notifyListeners();
    }
  }

  Future<void> disconnect(EldProvider provider) async {
    await api.delete('/eld/${provider.apiName}');
    await load();
  }
}
