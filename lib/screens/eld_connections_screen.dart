import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../services/eld_service.dart';

class EldConnectionsScreen extends StatefulWidget {
  const EldConnectionsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<EldConnectionsScreen> createState() => _EldConnectionsScreenState();
}

class _EldConnectionsScreenState extends State<EldConnectionsScreen> {
  late final EldService service;

  @override
  void initState() {
    super.initState();
    service = EldService(widget.api)..load();
  }

  @override
  void dispose() {
    service.dispose();
    super.dispose();
  }

  EldConnection? connection(EldProvider provider) {
    for (final item in service.connections) {
      if (item.provider == provider) return item;
    }
    return null;
  }

  Future<void> connect(EldProvider provider) async {
    try {
      final uri = await service.beginConnect(provider);
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw StateError('Could not open the provider authorization page.');
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Complete authorization in the browser, then return and refresh.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('ELD connections')),
    body: AnimatedBuilder(
      animation: service,
      builder: (context, _) => RefreshIndicator(
        onRefresh: service.load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'SemiTrax reads provider-authorized driver, vehicle, and HOS data. It does not modify or replace your legal ELD record.',
                ),
              ),
            ),
            if (service.loading) const LinearProgressIndicator(),
            if (service.error != null)
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: ListTile(
                  leading: const Icon(Icons.error_outline),
                  title: const Text('ELD request failed'),
                  subtitle: Text(service.error!),
                ),
              ),
            for (final provider in EldProvider.values)
              _providerCard(provider, connection(provider)),
            if (service.lastSnapshot case final snapshot?)
              _snapshotCard(snapshot),
          ],
        ),
      ),
    ),
  );

  Widget _providerCard(EldProvider provider, EldConnection? connection) {
    final connected = connection?.status == 'CONNECTED';
    final name = provider == EldProvider.samsara ? 'Samsara' : 'Motive';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              leading: Icon(connected ? Icons.link : Icons.link_off),
              title: Text(name),
              subtitle: Text(
                connection == null
                    ? 'Not connected'
                    : '${connection.status}${connection.lastSyncedAt == null ? '' : ' • synced ${connection.lastSyncedAt!.toLocal()}'}',
              ),
            ),
            if (connection?.lastErrorMessage case final message?)
              Text(
                message,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            Wrap(
              spacing: 8,
              children: [
                if (!connected)
                  FilledButton(
                    onPressed: service.loading ? null : () => connect(provider),
                    child: const Text('Connect'),
                  ),
                if (connected) ...[
                  FilledButton.tonal(
                    onPressed: service.loading
                        ? null
                        : () => service.sync(provider),
                    child: const Text('Sync now'),
                  ),
                  TextButton(
                    onPressed: service.loading
                        ? null
                        : () => service.disconnect(provider),
                    child: const Text('Disconnect'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _snapshotCard(Map<String, dynamic> snapshot) {
    final drivers = (snapshot['drivers'] as List? ?? const []).length;
    final vehicles = (snapshot['vehicles'] as List? ?? const []).length;
    final hos = (snapshot['hos'] as List? ?? const [])
        .cast<Map<String, dynamic>>();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Latest sync', style: Theme.of(context).textTheme.titleMedium),
            Text(
              '$drivers drivers • $vehicles vehicles • ${hos.length} HOS records',
            ),
            for (final record in hos.take(3))
              ListTile(
                dense: true,
                title: Text('Driver ${record['providerDriverId']}'),
                subtitle: Text(
                  [
                    if (record['remainingDriveSeconds'] != null)
                      'Drive remaining: ${Duration(seconds: (record['remainingDriveSeconds'] as num).toInt())}',
                    if (record['remainingOnDutySeconds'] != null)
                      'On-duty remaining: ${Duration(seconds: (record['remainingOnDutySeconds'] as num).toInt())}',
                    if (record['currentDutyStatus'] != null)
                      'Status: ${record['currentDutyStatus']}',
                  ].join(' • '),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
