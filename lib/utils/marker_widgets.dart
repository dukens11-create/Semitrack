/// Utility widgets for rendering map markers in the Semitrack app.
///
/// [buildCleanMarker] displays an asset image inside a circular container
/// with an optional white background and a subtle drop shadow.  It is
/// designed to be used as the visual representation of a Point-of-Interest
/// (truck stop, weigh station, etc.) on the map overlay.
///
/// [buildGpsPinMarker] renders any POI logo or fallback icon inside a
/// GPS teardrop-pin shape at a uniform size so every POI type looks
/// visually consistent on the map.
///
/// Example usage:
/// ```dart
/// buildCleanMarker('assets/logos/loves.png')
/// buildGpsPinMarker(pinColor: Colors.blue, imageBytes: bytes)
/// buildGpsPinMarker(pinColor: Colors.orange, fallbackIcon: Icons.scale)
/// ```
library marker_widgets;

import 'dart:typed_data';

import 'package:flutter/material.dart';

/// Builds a circular marker widget that wraps the given [asset] image.
///
/// The marker is a 50×50 [Container] with a circular [BoxDecoration],
/// an optional background color (defaults to [Colors.white]), and a subtle
/// drop shadow.  The asset image is clipped to a circle via [ClipOval] and
/// given 6 px of padding on all sides so it does not touch the container edge.
///
/// ### Parameters
/// - [asset]           – The asset path passed to [Image.asset]
///   (e.g. `'assets/logos/loves.png'`).
/// - [backgroundColor] – Circle background color.  Defaults to [Colors.white].
///   Pass [Colors.transparent] when the PNG already has a transparent/shaped
///   background and no solid fill is desired.
///
/// ### Returns
/// A [Widget] ready to embed in any map-overlay or list UI.
///
/// ### Example
/// ```dart
/// // White background (default):
/// buildCleanMarker('assets/logos/pilot.png')
///
/// // Transparent background (icon-only look):
/// buildCleanMarker('assets/logos/pilot.png', backgroundColor: Colors.transparent)
/// ```
// TODO: Adjust [backgroundColor] at the call site to switch between a solid
//       white circle and a fully transparent background depending on whether
//       the PNG asset already carries its own shaped/transparent background.
Widget buildCleanMarker(String asset, {Color backgroundColor = Colors.white}) {
  return Container(
    width: 50,
    height: 50,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: backgroundColor,
      boxShadow: const [
        BoxShadow(
          color: Colors.black38,
          blurRadius: 8,
          spreadRadius: 1,
        ),
      ],
    ),
    child: ClipOval(
      child: Padding(
        padding: const EdgeInsets.all(1),
        child: Image.asset(
          asset,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => const Icon(
            Icons.broken_image_outlined,
            size: 24,
            color: Colors.grey,
          ),
        ),
      ),
    ),
  );
}

/// Builds a GPS teardrop-pin [Widget] for a POI.
///
/// All POI types (truck stop, hotel, restaurant, rest area, gym,
/// commercial vehicle, weight station) are rendered at the same fixed
/// [pinSize] × [pinSize] bounding box so every marker is visually uniform
/// on the map.
///
/// The pin uses [Icons.location_on] as the outer teardrop shape, coloured
/// with [pinColor].  The circular head of the pin contains a white circle
/// that holds either:
/// - [imageBytes] decoded as an in-memory PNG logo, or
/// - [fallbackIcon] as a white Material icon when no image is available.
///
/// ### Parameters
/// - [pinColor]     – Colour of the teardrop pin shape.
/// - [imageBytes]   – Optional preloaded PNG bytes for the logo.  Takes
///                    precedence over [fallbackIcon] when non-null.
/// - [fallbackIcon] – Icon to display when [imageBytes] is null.
///                    Defaults to [Icons.location_on].
/// - [pinSize]      – Total bounding-box size in logical pixels.
///                    Defaults to `72`.  Keep consistent across call sites.
///
/// ### Returns
/// A [Widget] ready to embed in a [Marker] child.
Widget buildGpsPinMarker({
  required Color pinColor,
  Uint8List? imageBytes,
  IconData fallbackIcon = Icons.location_on,
  double pinSize = 72.0,
}) {
  // The head of the pin occupies roughly the top 65 % of the icon bounding box.
  // A larger headDiameter ratio (0.65) maximises the visible logo/icon area.
  // We leave a minimal inset so the white circle does not clip the pin outline.
  final double headDiameter = pinSize * 0.65;
  final double headInset = pinSize * 0.02;

  final Widget innerContent = imageBytes != null
      ? Image.memory(
          imageBytes,
          fit: BoxFit.cover,
          gaplessPlayback: true,
        )
      : Icon(fallbackIcon, size: headDiameter * 0.85, color: Colors.white);

  return SizedBox(
    width: pinSize,
    height: pinSize,
    child: Stack(
      alignment: Alignment.topCenter,
      children: [
        // Outer teardrop pin shape.
        Icon(Icons.location_on, size: pinSize, color: pinColor),
        // White circular background in the pin head.
        Positioned(
          top: headInset,
          child: Container(
            width: headDiameter,
            height: headDiameter,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white,
              boxShadow: const [
                BoxShadow(color: Colors.black26, blurRadius: 4),
              ],
            ),
            child: ClipOval(child: innerContent),
          ),
        ),
      ],
    ),
  );
}
