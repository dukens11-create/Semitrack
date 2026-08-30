import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

class OfflineRegionInfo {
  const OfflineRegionInfo({
    required this.id,
    required this.completed,
    required this.required,
    required this.bytes,
  });
  final String id;
  final int completed;
  final int required;
  final int bytes;
  double get progress => required == 0 ? 0 : completed / required;
  bool get isComplete => required > 0 && completed >= required;
}

class OfflineMapService extends ChangeNotifier {
  TileStore? _tileStore;
  OfflineManager? _offlineManager;
  List<OfflineRegionInfo> regions = const [];
  final Map<String, double> downloads = {};
  bool online = true;
  String? error;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;

  Future<void> initialize() async {
    _tileStore ??= await TileStore.createDefault();
    _offlineManager ??= await OfflineManager.create();
    _tileStore!.setDiskQuota(null);
    _connectivity ??= Connectivity().onConnectivityChanged.listen((results) {
      online = !results.contains(ConnectivityResult.none);
      notifyListeners();
      if (online) refresh();
    });
    final current = await Connectivity().checkConnectivity();
    online = !current.contains(ConnectivityResult.none);
    await refresh();
  }

  Future<void> refresh() async {
    try {
      final items = await _tileStore!.allTileRegions();
      regions = items
          .map(
            (region) => OfflineRegionInfo(
              id: region.id,
              completed: region.completedResourceCount,
              required: region.requiredResourceCount,
              bytes: region.completedResourceSize,
            ),
          )
          .toList(growable: false);
      error = null;
    } catch (exception) {
      error = exception.toString();
    }
    notifyListeners();
  }

  Future<void> download({
    required String id,
    required double west,
    required double south,
    required double east,
    required double north,
    bool wifiOnly = true,
  }) async {
    if (!online)
      throw StateError('Connect to the internet to download a map region.');
    final geometry = <String?, Object?>{
      'type': 'Polygon',
      'coordinates': [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    };
    final style = MapboxStyles.STANDARD;
    await _offlineManager!.loadStylePack(
      style,
      StylePackLoadOptions(
        glyphsRasterizationMode:
            GlyphsRasterizationMode.IDEOGRAPHS_RASTERIZED_LOCALLY,
        metadata: {'semitrack': true},
        acceptExpired: false,
      ),
      (_) {},
    );
    await _tileStore!.loadTileRegion(
      id,
      TileRegionLoadOptions(
        geometry: geometry,
        descriptorsOptions: [
          TilesetDescriptorOptions(
            styleURI: style,
            minZoom: 0,
            maxZoom: 16,
          ),
        ],
        metadata: {'name': id, 'kind': 'offline-map-only'},
        acceptExpired: true,
        networkRestriction: wifiOnly
            ? NetworkRestriction.DISALLOW_EXPENSIVE
            : NetworkRestriction.NONE,
      ),
      (progress) {
        downloads[id] = progress.requiredResourceCount == 0
            ? 0
            : progress.completedResourceCount / progress.requiredResourceCount;
        notifyListeners();
      },
    );
    downloads.remove(id);
    await refresh();
  }

  Future<void> delete(String id) async {
    await _tileStore!.removeRegion(id);
    await refresh();
  }

  @override
  void dispose() {
    _connectivity?.cancel();
    super.dispose();
  }
}
