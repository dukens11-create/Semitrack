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

/// The Mapbox image ID used as the fallback icon for POIs whose PNG asset is
/// not found in `assets/logo_brand_markers/`.  Must match a filename that exists
/// in the folder so it is registered by [registerPoiIcons].
const String _kPoiFallbackIcon = 'truck_parking';

/// Loads every [PoiItem] from `assets/locations.json`.
///
/// The JSON entries use the standardised schema with five required fields:
/// `id`, `name`, `icon` (PNG filename, e.g. `"pilot.png"`), `lat`, `lng`,
/// and `category` (e.g. `"truck_stop"`, `"weigh_station"`, `"rest_area"`).
///
/// The `icon` value is normalised via [poiIconId] so that it matches the
/// Mapbox image ID registered by [registerPoiIcons]
/// (e.g. `"pilot.png"` → `"pilot"`, `"flying_j_truck_stop.png"` → `"flying_j_truck_stop"`).
///
/// **Icon validation:** the normalised icon ID is cross-checked against the
/// set of PNG assets actually bundled in `assets/logo_brand_markers/`.  If no
/// matching PNG is found, an error is logged and the icon falls back to
/// [_kPoiFallbackIcon] so the POI is still rendered as a visible marker.
///
/// No proximity or category filter is applied; every entry in the file is
/// returned so that all USA and Canada POIs appear as markers on the map.
Future<List<PoiItem>> loadAllPois() async {
  final String jsonString =
      await rootBundle.loadString('assets/locations.json');
  final List<dynamic> data = jsonDecode(jsonString) as List<dynamic>;

  // Build the set of icon IDs that are actually bundled in assets/logo_brand_markers/
  // by scanning the asset manifest and normalising each PNG filename.
  // This works on all platforms (Android, iOS, web, desktop) without dart:io.
  // Note: AssetManifest.loadFromAssetBundle is called once here because
  // loadAllPois() is called at most once per map style load (guarded by the
  // styleSourceExists check in _setupPoiCluster).
  final AssetManifest manifest =
      await AssetManifest.loadFromAssetBundle(rootBundle);
  final Set<String> bundledIconIds = manifest
      .listAssets()
      .where(
        (key) =>
            key.startsWith('assets/logo_brand_markers/') && key.endsWith('.png'),
      )
      .map((key) => poiIconId(key.split('/').last))
      .toSet();

  return data.map((entry) {
    final Map<String, dynamic> json = entry as Map<String, dynamic>;
    final String rawIcon = json['icon'] as String;
    final String normalizedId = poiIconId(rawIcon);

    // Validate the normalised icon ID against the bundled PNG set.
    // If the PNG is absent, log a clear error and fall back to the default
    // marker icon so the POI is always visible on the map.
    final String resolvedIcon;
    if (bundledIconIds.contains(normalizedId)) {
      resolvedIcon = normalizedId;
    } else {
      // TODO(production): Keep this error log — it identifies JSON icon values
      // that have no matching PNG in assets/logo_brand_markers/.
      debugPrint(
        '[POI Load] ✗ Icon not found for "${json['name'] as String}": '
        '"$rawIcon" → "$normalizedId" has no matching PNG in '
        'assets/logo_brand_markers/. Using fallback icon "$_kPoiFallbackIcon".',
      );
      resolvedIcon = _kPoiFallbackIcon;
    }

    return PoiItem(
      // Read id and category directly from the standardised JSON schema.
      id: json['id'] as String,
      name: json['name'] as String,
      category: json['category'] as String,
      // Resolved icon: normalised PNG filename if the asset exists, otherwise
      // the fallback icon so the POI still renders as a visible marker.
      icon: resolvedIcon,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      country: (json['country'] as String?) ?? '',
      stateOrProvince: (json['stateOrProvince'] as String?) ?? '',
      city: (json['city'] as String?) ?? '',
      exitNumber: json['exit_number'] as String?,
    );
  }).toList();
}

/// Converts [pois] to a GeoJSON FeatureCollection map.
///
/// Each feature carries the core [PoiItem] fields as GeoJSON properties.  The
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
            },
          },
        )
        .toList(),
  };
}

/// Registers every unique PNG in `assets/logo_brand_markers/` as a named image
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
            key.startsWith('assets/logo_brand_markers/') && key.endsWith('.png'),
      )
      .toList();

  // TODO(production): Remove this log line before releasing.
  debugPrint(
    '[POI Icons] Found ${pngAssets.length} PNG(s) in assets/logo_brand_markers/ '
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
    'Registered IDs: ${(registered.toList()..sort())}',
  );

  return registered;
}

/// Audits POI icon assets for debugging marker-visibility issues.
///
/// Compiles the set of unique icon IDs referenced by [pois] and prints each
/// one so developers can match JSON `"icon"` values to actual PNG filenames
/// in `assets/logo_brand_markers/`.
///
/// Uses the Flutter [AssetManifest] to discover which PNGs are actually
/// bundled, computes their normalised Mapbox image IDs via [poiIconId], and
/// cross-checks each POI icon ID against that set.  An icon ID that is
/// `[MISSING]` in this output means no PNG in `assets/logo_brand_markers/`
/// normalises to that ID — either the file is absent or the filename does not
/// match the JSON value after normalisation.
///
/// **How to match POI JSON values to filenames:**
///   • The JSON `"icon"` field (e.g. `"flying_j_truck_stop"`) is
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
    debugPrint('[POI Audit]   icon id: "$id"');
  }

  // Build the set of icon IDs that are actually bundled in assets/logo_brand_markers/
  // by scanning the asset manifest and normalising each PNG filename.
  // This works on all platforms (Android, iOS, web, desktop) without dart:io.
  // TODO(production): Remove this block before releasing.
  final AssetManifest manifest =
      await AssetManifest.loadFromAssetBundle(rootBundle);
  final Set<String> bundledIds = manifest
      .listAssets()
      .where(
        (key) =>
            key.startsWith('assets/logo_brand_markers/') && key.endsWith('.png'),
      )
      .map((key) => poiIconId(key.split('/').last))
      .toSet();

  debugPrint(
    '[POI Audit] Cross-checking POI icon IDs against bundled PNGs '
    '(${bundledIds.length} PNG(s) found in assets/logo_brand_markers/):',
  );
  for (final id in sortedIcons) {
    final bool found = bundledIds.contains(id);
    debugPrint(
      found
          ? '[POI Audit]   [FOUND]   "$id" — PNG is bundled and will be registered.'
          : '[POI Audit]   [MISSING] "$id" — No PNG in assets/logo_brand_markers/ '
              'normalises to this ID. '
              'Check the filename in the folder matches the JSON icon value.',
    );
  }
}
