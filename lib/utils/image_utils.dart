// Utility function for loading and resizing image assets to PNG bytes.

import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/services.dart';

/// Loads an image asset from [path], resizes it to 256×256 pixels,
/// and returns the result as PNG-encoded [Uint8List] bytes.
Future<Uint8List> loadImage(String path) async {
  final ByteData data = await rootBundle.load(path);

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
    throw Exception('Failed to convert image to byte data');
  }

  return byteData.buffer.asUint8List();
}
