// Utility function for loading and resizing image assets to raw RGBA bytes
// for use with the Mapbox Maps Flutter SDK (StyleManager.addStyleImage).

import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

/// Target icon size used for Mapbox symbol-layer images (width = height).
const int _kIconSize = 256;

/// Loads an image asset from [path], resizes it to [_kIconSize]×[_kIconSize]
/// pixels, and returns the raw premultiplied-RGBA [Uint8List] together with
/// the decoded [ui.Image] dimensions required by [MbxImage].
///
/// The return value is a record `(width, height, rgbaBytes)`.
Future<(int, int, Uint8List)> _loadImageRgba(String path) async {
  final ByteData data = await rootBundle.load(path);

  final codec = await ui.instantiateImageCodec(
    data.buffer.asUint8List(),
    targetWidth: _kIconSize,
    targetHeight: _kIconSize,
  );

  final frame = await codec.getNextFrame();
  codec.dispose();

  final img = frame.image;
  final width = img.width;
  final height = img.height;

  // rawRgba produces the 32-bit premultiplied RGBA data that MbxImage expects.
  final byteData = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
  img.dispose();

  if (byteData == null) {
    throw Exception('Failed to convert image to raw RGBA byte data for $path');
  }

  return (width, height, byteData.buffer.asUint8List());
}

/// Loads truck stop brand logo assets and registers each one as a named
/// image in the Mapbox [mapboxMap] style, ready to be referenced by
/// symbol layers or annotations.
///
/// The following image keys are registered (all sized to [_kIconSize]×[_kIconSize] px):
/// - `loves`  → assets/logos/loves.png
/// - `pilot`  → assets/logos/pilot.png
/// - `ta`     → assets/logos/ta.png
/// - `qt`     → assets/logos/qt.png
/// - `petro`  → assets/logos/petro.png
/// - `ambest` → assets/logos/ambest.png
///
/// Each image is loaded and added independently; if one fails the error is
/// logged and the remaining images are still attempted.
Future<void> addTruckStopImages(MapboxMap mapboxMap) async {
  final logos = {
    'loves': 'assets/logos/loves.png',
    'pilot': 'assets/logos/pilot.png',
    'ta': 'assets/logos/ta.png',
    'qt': 'assets/logos/qt.png',
    'petro': 'assets/logos/petro.png',
    'ambest': 'assets/logos/ambest.png',
  };

  for (final entry in logos.entries) {
    try {
      final (width, height, rgbaBytes) = await _loadImageRgba(entry.value);
      // StyleManager.addImage does not exist in mapbox_maps_flutter ≥ 2.x.
      // The correct API is addStyleImage which requires a MbxImage (raw RGBA).
      await mapboxMap.style.addStyleImage(
        entry.key,
        1.0, // device-pixel-ratio scale factor
        MbxImage(width: width, height: height, data: rgbaBytes),
        false, // sdf: false – raster logo, not signed-distance field
        [], // stretchX
        [], // stretchY
        null, // content
      );
    } catch (e) {
      // Log the error but continue loading remaining logos.
      debugPrint('Failed to load or add logo "${entry.key}": $e');
    }
  }
}
