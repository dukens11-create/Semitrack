// Utility function for loading and resizing image assets to PNG bytes.

import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

/// Loads an image asset from [path], resizes it to 256×256 pixels, and
/// returns the result as PNG-encoded [Uint8List] data.
Future<Uint8List> loadImage(String path) async {
  final ByteData data = await rootBundle.load(path);

  // 256×256 px matches the recommended Mapbox symbol-layer icon size,
  // balancing visual quality with GPU texture memory usage.
  final codec = await ui.instantiateImageCodec(
    data.buffer.asUint8List(),
    targetWidth: 256,
    targetHeight: 256,
  );

  final frame = await codec.getNextFrame();
  codec.dispose();

  final byteData =
      await frame.image.toByteData(format: ui.ImageByteFormat.png);

  if (byteData == null) {
    throw Exception('Failed to convert image to byte data for $path');
  }

  return byteData.buffer.asUint8List();
}

/// Loads truck stop brand logo assets and registers each one as a named
/// image in the Mapbox [mapboxMap] style, ready to be referenced by
/// symbol layers or annotations.
///
/// The following image keys are registered (all sized to 256×256 px):
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
      final Uint8List bytes = await loadImage(entry.value);
      await mapboxMap.style.addImage(
        entry.key,
        bytes,
        sdf: false,
      );
    } catch (e) {
      // Log the error but continue loading remaining logos.
      debugPrint('Failed to load or add logo "${entry.key}": $e');
    }
  }
}
