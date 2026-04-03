import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mbx;

import 'package:semitrack_mobile/models/poi_item.dart';

/// Normalises a PNG filename to a Mapbox image ID.
///
/// Strips the `.png` suffix (plus any surrounding whitespace), trims the
/// remainder, lowercases it, and replaces runs of spaces or hyphens with
/// underscores.
///
/// Examples:
///   `"pilot.png"`               → `"pilot"`
///   `"flying j truck stop.png"` → `"flying_j_truck_stop"`
///   `"weight station .png"`     → `"weight_station"`
String poiIconId(String filename) {
  return filename
      .replaceAll(RegExp(r'\s*\.png\s*$', caseSensitive: false), '')
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[\s\-]+'), '_');
}

/// Loads every [PoiItem] from `assets/truck_stop_poi/locations.json`.
///
/// The JSON entries in that file use a simplified schema — they carry `name`,
/// `icon` (a `.png` filename), `lat`, `lng`, `country`, `stateOrProvince`,
/// and `city`, but do **not** include `id` or `category`.  This function
/// synthesises the missing fields:
///   - `id`       — `"ts_NNNNN"` where NNNNN is the zero-padded list index.
///   - `category` — always `"truck_stop"` for this dataset.
///   - `icon`     — normalised via [poiIconId] so that it matches the Mapbox
///                  image ID registered by [registerPoiIcons]
///                  (e.g. `"flying j truck stop.png"` → `"flying_j_truck_stop"`).
///
/// No proximity or category filter is applied; every entry in the file is
/// returned so that all truck stops appear as markers on the map.
Future<List<PoiItem>> loadAllPois() async {
  final String jsonString =
      await rootBundle.loadString('assets/truck_stop_poi/locations.json');
  final List<dynamic> data = jsonDecode(jsonString) as List<dynamic>;

  return data.asMap().entries.map((entry) {
    final int index = entry.key;
    final Map<String, dynamic> json = entry.value as Map<String, dynamic>;

    return PoiItem(
      // Synthesise a stable ID from the list position.
      id: 'ts_${index.toString().padLeft(5, '0')}',
      name: json['name'] as String,
      // All entries in this file are truck stops.
      category: 'truck_stop',
      // Normalise "flying j truck stop.png" → "flying_j_truck_stop" so that
      // the value matches the Mapbox image ID registered by registerPoiIcons.
      icon: poiIconId(json['icon'] as String),
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      country: json['country'] as String,
      stateOrProvince: json['stateOrProvince'] as String,
      city: json['city'] as String,
    );
  }).toList();
}

/// Converts [pois] to a GeoJSON FeatureCollection map.
///
/// Each feature carries all [PoiItem] fields as GeoJSON properties.  The
/// `icon` property matches a Mapbox image ID registered via [registerPoiIcons],
/// enabling `["get", "icon"]` expressions in symbol layers.
Map<String, dynamic> poisToGeoJson(List<PoiItem> pois) {
  return {
    'type': 'FeatureCollection',
    'features': pois
        .map(
          (poi) => {
            'type': 'Feature',
            'id': poi.id,
            'geometry': {
              'type': 'Point',
              'coordinates': [poi.lng, poi.lat],
            },
            'properties': {
              'id': poi.id,
              'name': poi.name,
              'category': poi.category,
              'icon': poi.icon,
              'country': poi.country,
              'stateOrProvince': poi.stateOrProvince,
              'city': poi.city,
            },
          },
        )
        .toList(),
  };
}

/// Registers every unique PNG in `assets/truck_stop_poi/` as a named image
/// in the Mapbox [style].
///
/// Image IDs are derived from filenames via [poiIconId], so callers can
/// reference them in layer expressions using `['get', 'icon']`.
///
/// Each PNG is decoded to raw RGBA pixel data before registration so that
/// [mbx.MbxImage] receives accurate dimensions and pixel-level content.
/// Assets that cannot be loaded or decoded are silently skipped.
///
/// Returns the set of successfully registered image IDs.
Future<Set<String>> registerPoiIcons(mbx.StyleManager style) async {
  final AssetManifest manifest =
      await AssetManifest.loadFromAssetBundle(rootBundle);
  final List<String> pngAssets = manifest
      .listAssets()
      .where(
        (key) =>
            key.startsWith('assets/truck_stop_poi/') && key.endsWith('.png'),
      )
      .toList();

  final Set<String> registered = {};

  for (final assetPath in pngAssets) {
    final String fileName = assetPath.split('/').last;
    final String imageId = poiIconId(fileName);
    try {
      final ByteData byteData = await rootBundle.load(assetPath);
      final Uint8List pngBytes = byteData.buffer.asUint8List();

      // Decode PNG to obtain accurate dimensions and raw RGBA pixel data.
      final Completer<ui.Image> completer = Completer();
      ui.decodeImageFromList(pngBytes, completer.complete);
      final ui.Image decoded = await completer.future;

      final ByteData? rgbaData =
          await decoded.toByteData(format: ui.ImageByteFormat.rawRgba);
      if (rgbaData == null) continue;

      await style.addStyleImage(
        imageId,
        1.0,
        mbx.MbxImage(
          width: decoded.width,
          height: decoded.height,
          data: rgbaData.buffer.asUint8List(),
        ),
        false,
        [],
        [],
        null,
      );
      registered.add(imageId);
    } catch (e) {
      // Asset unreadable or decode failed — skip this icon and log for diagnostics.
      debugPrint('poi_service: failed to register icon "$imageId" '
          'from $assetPath: $e');
    }
  }

  return registered;
}
