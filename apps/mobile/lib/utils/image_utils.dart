import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

/// Loads a PNG asset from the Flutter asset bundle and returns its raw bytes.
///
/// [assetPath] must be a registered asset path declared in `pubspec.yaml`
/// (e.g. `'assets/logos/loves.png'`).
///
/// Throws a [FlutterError] if the asset cannot be found.
Future<Uint8List> loadImage(String assetPath) async {
  final data = await rootBundle.load(assetPath);
  return data.buffer.asUint8List();
}

/// Registers all truck stop logo PNG assets with the Mapbox map style.
///
/// Each image is added via [style.addImage] with [sdf] set to `false` so the
/// full-colour RGBA PNG is rendered as-is — no tinting, no box background.
///
/// Call this function after the Mapbox style has finished loading, before
/// creating any symbol layers or annotations that reference these images.
///
/// Example usage:
/// ```dart
/// mapboxMap.style.onStyleLoaded.listen((_) async {
///   await addTruckStopImages(mapboxMap);
///   // Now safe to add SymbolLayers / PointAnnotations using the icon keys.
/// });
/// ```
///
/// After registering, create annotations with [SymbolOptions] like so:
/// ```dart
/// SymbolOptions(
///   geometry: Point(coordinates: Position(poi.lng, poi.lat)),
///   iconImage: 'loves',           // EXACT key used in addImage above
///   iconSize: 0.5,
///   iconAnchor: IconAnchor.CENTER,
///   iconOpacity: 1.0,
///   iconAllowOverlap: true,
///   iconIgnorePlacement: true,
///   // Do NOT set iconColor / iconHaloColor / iconHaloWidth unless
///   // intentional — these can add coloured fills or outlines that
///   // produce the unwanted "box look" around the icon.
/// )
/// ```
///
/// ─────────────────────────────────────────────────────────────────────────
/// CHECKLIST FOR FUTURE DEVELOPERS — PNG asset requirements
/// ─────────────────────────────────────────────────────────────────────────
/// 1. ✅ ALL PNG assets MUST have a transparent background (RGBA, not RGB).
///    A solid white/coloured background produces a visible "box look" on the
///    map even when [sdf] is false.
/// 2. ✅ The key passed as the first argument to [style.addImage] MUST
///    exactly match (case-sensitive) the [iconImage] string used in
///    [SymbolOptions] — e.g. register as `"loves"` and use
///    `iconImage: "loves"` (not `"Loves"` or `"LOVES"`).
/// 3. ✅ Always pass `sdf: false` for full-colour PNG logos.
///    Use `sdf: true` ONLY for monochrome silhouettes you want to tint via
///    [iconColor].
/// 4. ✅ Do NOT set [iconColor], [iconHaloColor], or [iconHaloWidth] unless
///    intentional — these can add coloured fills or outlines around the icon
///    and are the most common source of the "box look".
/// 5. ✅ Always set [iconAnchor] to [IconAnchor.CENTER], [iconOpacity] to
///    `1.0`, [iconAllowOverlap] to `true`, and [iconIgnorePlacement] to
///    `true` so icons are fully visible and centred on their coordinates.
/// ─────────────────────────────────────────────────────────────────────────
Future<void> addTruckStopImages(MapboxMap mapboxMap) async {
  // Map of icon registration key → asset path.
  // The key MUST match the iconImage string used in SymbolOptions exactly
  // (case-sensitive). Keys mirror the TruckStop.icon values used throughout
  // the app so that the same identifier can be used in both flutter_map and
  // Mapbox native SDK contexts.
  const logos = <String, String>{
    'loves':       'assets/logos/loves.png',
    'pilot':       'assets/logos/pilot.png',
    'ta':          'assets/logos/ta.png',
    'petro':       'assets/logos/petro.png',
    'ambest':      'assets/logos/ambest.png',
    'flyingj':     'assets/logos/flying j.png',
    'mobil':       'assets/logos/mobil.png',
    'chevron':     'assets/logos/chevron.png',
    'shell':       'assets/logos/shell.png',
    'bp':          'assets/logos/bp.png',
    'circlek':     'assets/logos/circle k.png',
    'roadranger':  'assets/logos/road ranger.png',
    'quicktrip':   'assets/logos/quicktrip.png',
    'esso':        'assets/logos/esso.png',
    'petrocanada': 'assets/logos/petro-canada.png',
    'walmart':     'assets/logos/walmart.png',
    'hotel':       'assets/logos/hotel.png',
    'restaurant':  'assets/logos/restaurant .png',
    'truckwash':   'assets/logos/semi truck wash.png',
    'gym':         'assets/logos/gym.png',
    'weigh':       'assets/logos/weight station .png',
    'rest':        'assets/logos/rest la area.png',
    'maverik':     'assets/logos/adventure s first stop.png',
  };

  for (final entry in logos.entries) {
    try {
      final bytes = await loadImage(entry.value);
      // sdf: false → render the full-colour RGBA PNG without tinting.
      // Required to avoid the "box look" on transparent-background icons.
      await mapboxMap.style.addImage(entry.key, bytes, sdf: false);
    } catch (e) {
      // Log and continue — a missing logo must not block the rest from loading.
      // ignore: avoid_print
      print('image_utils: failed to register logo "${entry.key}": $e');
    }
  }
}
