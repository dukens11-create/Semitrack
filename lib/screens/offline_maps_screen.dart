import 'package:flutter/material.dart';

import '../services/offline_map_service.dart';

class OfflineMapsScreen extends StatefulWidget {
  const OfflineMapsScreen({super.key});

  @override
  State<OfflineMapsScreen> createState() => _OfflineMapsScreenState();
}

class _OfflineMapsScreenState extends State<OfflineMapsScreen> {
  final service = OfflineMapService();

  static const available = {
    'Oregon': (-124.75, 41.95, -116.45, 46.35),
    'Washington': (-124.85, 45.50, -116.85, 49.05),
    'Idaho': (-117.25, 41.95, -111.00, 49.05),
    'Nevada': (-120.05, 35.00, -114.00, 42.05),
  };

  @override
  void initState() {
    super.initState();
    service.initialize();
  }

  @override
  void dispose() {
    service.dispose();
    super.dispose();
  }

  String _size(int bytes) => bytes < 1024 * 1024
      ? '${(bytes / 1024).toStringAsFixed(1)} KB'
      : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Offline maps')),
      body: AnimatedBuilder(
        animation: service,
        builder: (context, _) => RefreshIndicator(
          onRefresh: service.refresh,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                color: service.online
                    ? Theme.of(context).colorScheme.surfaceContainerHighest
                    : Theme.of(context).colorScheme.errorContainer,
                child: ListTile(
                  leading:
                      Icon(service.online ? Icons.cloud_done : Icons.cloud_off),
                  title: Text(service.online ? 'Online' : 'No network'),
                  subtitle: const Text(
                    'Downloads provide offline map display and cached assets. '
                    'They do not provide true offline truck route calculation.',
                  ),
                ),
              ),
              if (service.error != null)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.error_outline),
                    title: const Text('Offline map error'),
                    subtitle: Text(service.error!),
                  ),
                ),
              const SizedBox(height: 8),
              Text('Available regions',
                  style: Theme.of(context).textTheme.titleLarge),
              for (final entry in available.entries)
                Builder(builder: (context) {
                  final downloaded = service.regions
                      .where((item) => item.id == entry.key)
                      .firstOrNull;
                  final progress = service.downloads[entry.key];
                  return Card(
                    child: ListTile(
                      title: Text(entry.key),
                      subtitle: progress != null
                          ? LinearProgressIndicator(value: progress)
                          : Text(downloaded == null
                              ? 'Not downloaded'
                              : '${downloaded.isComplete ? 'Downloaded' : 'Incomplete'} • ${_size(downloaded.bytes)}'),
                      trailing: downloaded == null
                          ? FilledButton(
                              onPressed: progress != null || !service.online
                                  ? null
                                  : () {
                                      final box = entry.value;
                                      service.download(
                                        id: entry.key,
                                        west: box.$1,
                                        south: box.$2,
                                        east: box.$3,
                                        north: box.$4,
                                      );
                                    },
                              child: const Text('Download'),
                            )
                          : IconButton(
                              onPressed: () => service.delete(entry.key),
                              icon: const Icon(Icons.delete_outline),
                              tooltip: 'Delete',
                            ),
                    ),
                  );
                }),
            ],
          ),
        ),
      ),
    );
  }
}
