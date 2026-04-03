import 'dart:async';
import 'dart:convert';
// dart:io is used only for desktop file-existence auditing (see auditPoiIconAssets).
// It is safe to import here — on Android/iOS/Web the Platform and File APIs
// referenced below are guarded by kIsWeb / Platform checks so they are never
// called on unsupported targets.
import 'dart:io' show File, Platform;
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
///
/// Debug audit logging is included to help diagnose missing markers:
///   • Prints each filename and derived image ID before registration.
///   • Logs success (✓) or failure (✗) for every icon.
///   • Summarises total registered / attempted counts at the end.
///
/// // TODO(production): Replace the per-icon debugPrint calls below with a
/// // single summary line (or remove entirely) before releasing to production.
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

  // TODO(production): Remove this log line before releasing.
  debugPrint(
    '[POI Icons] Found ${pngAssets.length} PNG(s) in assets/truck_stop_poi/ '
    'to register with Mapbox.',
  );

  final Set<String> registered = {};

  for (final assetPath in pngAssets) {
    final String fileName = assetPath.split('/').last;
    final String imageId = poiIconId(fileName);

    // TODO(production): Remove this per-icon log line before releasing.
    debugPrint('[POI Icons] Registering "$imageId"  ← file: "$fileName"');

    try {
      final ByteData byteData = await rootBundle.load(assetPath);
      final Uint8List pngBytes = byteData.buffer.asUint8List();

      // Decode PNG to obtain accurate dimensions and raw RGBA pixel data.
      final Completer<ui.Image> completer = Completer();
      ui.decodeImageFromList(pngBytes, completer.complete);
      final ui.Image decoded = await completer.future;

      final ByteData? rgbaData =
          await decoded.toByteData(format: ui.ImageByteFormat.rawRgba);
      if (rgbaData == null) {
        // TODO(production): Remove this log line before releasing.
        debugPrint('[POI Icons]   ✗ Could not decode RGBA data for "$imageId"');
        continue;
      }

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

      // TODO(production): Remove this success log line before releasing.
      debugPrint('[POI Icons]   ✓ Registered "$imageId" successfully.');
    } catch (e) {
      // Asset unreadable or decode failed — log error for diagnostics.
      // TODO(production): Replace with a silent skip (remove debugPrint) before releasing.
      debugPrint(
        '[POI Icons]   ✗ Failed to register "$imageId" from "$assetPath": $e',
      );
    }
  }

  // TODO(production): Remove this summary log line before releasing.
  debugPrint(
    '[POI Icons] Registration complete: '
    '${registered.length} of ${pngAssets.length} icon(s) registered. '
    'Registered IDs: ${registered.toList()..sort()}',
  );

  return registered;
}

/// Audits POI icon assets for debugging marker-visibility issues.
///
/// Compiles the set of unique icon IDs referenced by [pois] and prints each
/// one so developers can match JSON `"icon"` values to actual PNG filenames
/// in `assets/truck_stop_poi/`.
///
/// Uses the Flutter [AssetManifest] to discover which PNGs are actually
/// bundled, computes their normalised Mapbox image IDs via [poiIconId], and
/// cross-checks each POI icon ID against that set.  An icon ID that is
/// `[MISSING]` in this output means no PNG in `assets/truck_stop_poi/`
/// normalises to that ID — either the file is absent or the filename does not
/// match the JSON value after normalisation.
///
/// On desktop platforms (macOS, Linux, Windows) a secondary check also
/// attempts to verify file paths directly via `dart:io`.
///
/// **How to match POI JSON values to filenames:**
///   • The JSON `"icon"` field (e.g. `"flying j truck stop.png"`) is
///     normalised by [poiIconId] before being stored in [PoiItem.icon].
///   • [registerPoiIcons] registers each PNG under the same normalised ID.
///   • If a POI icon ID printed here does NOT appear in the registration log
///     produced by [registerPoiIcons], the PNG is either missing from the
///     asset bundle or named differently than the JSON expects.
///
/// // TODO(production): Remove this function and its call site in
/// // TruckMapScreen._setupPoiCluster before releasing to production.
Future<void> auditPoiIconAssets(List<PoiItem> pois) async {
  final List<String> sortedIcons =
      pois.map((p) => p.icon).toSet().toList()..sort();

  debugPrint(
    '[POI Audit] ${sortedIcons.length} unique icon ID(s) referenced by POIs:',
  );
  for (final id in sortedIcons) {
    debugPrint('  icon id: "$id"');
  }

  // Build the set of icon IDs that are actually bundled in assets/truck_stop_poi/
  // by scanning the asset manifest and normalising each PNG filename.
  // This works on all platforms (Android, iOS, web, desktop).
  // TODO(production): Remove this block before releasing.
  final AssetManifest manifest =
      await AssetManifest.loadFromAssetBundle(rootBundle);
  final Set<String> bundledIds = manifest
      .listAssets()
      .where(
        (key) =>
            key.startsWith('assets/truck_stop_poi/') && key.endsWith('.png'),
      )
      .map((key) => poiIconId(key.split('/').last))
      .toSet();

  debugPrint(
    '[POI Audit] Cross-checking POI icon IDs against bundled PNGs '
    '(${bundledIds.length} PNG(s) found in assets/truck_stop_poi/):',
  );
  for (final id in sortedIcons) {
    final bool found = bundledIds.contains(id);
    debugPrint(
      found
          ? '[POI Audit]   [FOUND]   "$id" — PNG is bundled and will be registered.'
          : '[POI Audit]   [MISSING] "$id" — No PNG in assets/truck_stop_poi/ '
              'normalises to this ID. '
              'Check the filename in the folder matches the JSON icon value.',
    );
  }

  // On desktop, also attempt a secondary file-system check using dart:io.
  // Note: the normalised ID (e.g. "flying_j_truck_stop") will not match the
  // original filename ("flying j truck stop.png") directly, so this check
  // is only informational — use the manifest check above for accuracy.
  // TODO(production): Remove this block before releasing.
  if (!kIsWeb) {
    bool isDesktop = false;
    try {
      isDesktop =
          Platform.isMacOS || Platform.isLinux || Platform.isWindows;
    } catch (_) {
      // Platform not available on this target — skip silently.
    }
    if (isDesktop) {
      debugPrint(
        '[POI Audit] Desktop file-system check '
        '(note: normalised IDs differ from original filenames — '
        'use the manifest check above for authoritative results):',
      );
      for (final id in sortedIcons) {
        final String candidate = 'assets/truck_stop_poi/$id.png';
        final bool exists = File(candidate).existsSync();
        debugPrint(
          exists
              ? '[POI Audit]   [FOUND on disk]   $candidate'
              : '[POI Audit]   [NOT FOUND on disk] $candidate  '
                  '(original filename likely differs — see manifest check above)',
        );
      }
    }
  }
}
