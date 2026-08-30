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
        BoxShadow(color: Colors.black38, blurRadius: 8, spreadRadius: 1),
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

/// Builds the shared outlined teardrop marker used by every map POI.
///
/// The custom-painted silhouette has a dark edge, thick white keyline,
/// category-coloured centre, and an exact bottom-centre map anchor. Branded
/// images sit on a white disc; category fallback icons remain white on colour.
Widget buildGpsPinMarker({
  required Color pinColor,
  Uint8List? imageBytes,
  IconData fallbackIcon = Icons.location_on,
  double pinSize = 66.0,
}) {
  // A larger head and tighter logo padding keep real brand marks readable at
  // normal navigation zoom without making the map pin excessively tall.
  final double headDiameter = pinSize * 0.62;
  final double headInset = pinSize * 0.065;

  final Widget innerContent = imageBytes != null
      ? Padding(
          padding: EdgeInsets.all(pinSize * 0.025),
          child: Image.memory(
            imageBytes,
            fit: BoxFit.contain,
            gaplessPlayback: true,
            filterQuality: FilterQuality.high,
          ),
        )
      : Icon(fallbackIcon, size: headDiameter * 0.66, color: Colors.white);

  return SizedBox(
    width: pinSize,
    height: pinSize,
    child: Stack(
      children: [
        Positioned.fill(
          child: CustomPaint(
            key: const ValueKey<String>('poi-pin-shape'),
            painter: _PoiPinPainter(pinColor),
          ),
        ),
        Positioned(
          top: headInset,
          left: (pinSize - headDiameter) / 2,
          child: Container(
            width: headDiameter,
            height: headDiameter,
            decoration: imageBytes == null
                ? null
                : const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white,
                  ),
            child: ClipOval(child: innerContent),
          ),
        ),
      ],
    ),
  );
}

/// Builds a count marker with the same pin silhouette as individual POIs.
Widget buildGpsPinClusterMarker({
  required int count,
  Color pinColor = const Color(0xFF1489C7),
  double pinSize = 66.0,
}) {
  final String label = count > 99 ? '99+' : '$count';
  return SizedBox(
    width: pinSize,
    height: pinSize,
    child: Stack(
      children: [
        Positioned.fill(
          child: CustomPaint(
            key: const ValueKey<String>('poi-cluster-pin-shape'),
            painter: _PoiPinPainter(pinColor),
          ),
        ),
        Positioned(
          top: pinSize * 0.13,
          left: pinSize * 0.23,
          child: Container(
            width: pinSize * 0.54,
            height: pinSize * 0.54,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white,
            ),
            child: Text(
              label,
              style: TextStyle(
                color: const Color(0xFF12324A),
                fontSize: label.length > 2 ? pinSize * 0.19 : pinSize * 0.23,
                fontWeight: FontWeight.w900,
                height: 1,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _PoiPinPainter extends CustomPainter {
  const _PoiPinPainter(this.color);

  final Color color;

  Path _path(Size size) {
    final double width = size.width;
    final double height = size.height;
    final double centerX = width / 2;
    final double top = height * 0.075;
    final double side = width * 0.115;
    final double headBottom = height * 0.61;
    final double tipY = height * 0.94;

    return Path()
      ..moveTo(centerX, tipY)
      ..cubicTo(
        width * 0.68,
        height * 0.77,
        width - side,
        headBottom,
        width - side,
        height * 0.36,
      )
      ..cubicTo(width - side, height * 0.17, width * 0.72, top, centerX, top)
      ..cubicTo(width * 0.28, top, side, height * 0.17, side, height * 0.36)
      ..cubicTo(side, headBottom, width * 0.32, height * 0.77, centerX, tipY)
      ..close();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final Path path = _path(size);
    canvas.drawShadow(path, Colors.black87, size.width * 0.07, false);
    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0xFF12324A)
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round
        ..strokeWidth = size.width * 0.13,
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round
        ..strokeWidth = size.width * 0.09,
    );
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _PoiPinPainter oldDelegate) =>
      oldDelegate.color != color;
}
