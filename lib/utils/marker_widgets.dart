/// Utility widgets for rendering map markers in the Semitrack app.
///
/// [buildCleanMarker] displays an asset image inside a circular container
/// with an optional white background and a subtle drop shadow.  It is
/// designed to be used as the visual representation of a Point-of-Interest
/// (truck stop, weigh station, etc.) on the map overlay.
///
/// Example usage:
/// ```dart
/// buildCleanMarker('assets/logos/loves.png')
/// ```
library marker_widgets;

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
          color: Colors.black26,
          blurRadius: 6,
        ),
      ],
    ),
    child: ClipOval(
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Image.asset(
          asset,
          fit: BoxFit.contain,
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
