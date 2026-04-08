/// Navigation utility functions for camera and map control.
///
/// These helpers translate real-time vehicle telemetry (speed, heading, etc.)
/// into map-camera parameters so the driver always has an appropriate view.

import 'dart:math';

import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Timestamp of the most recent successful camera update.
///
/// Declared at module level so it persists across [updateCamera] calls within
/// the same app session.  When this utility is used inside a `State` class you
/// may instead declare a matching `DateTime` field there and pass it in – or
/// simply rely on this shared variable if only one camera owner is active at a
/// time.
///
/// Initialized to the epoch so the very first call is never throttled.
DateTime _lastCameraUpdate = DateTime.fromMillisecondsSinceEpoch(0);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Returns the recommended map zoom level for [speedMph].
///
/// Zoom decreases as speed increases so more road is visible ahead:
///
/// | Speed (mph) | Zoom |
/// |-------------|------|
/// | < 5         | 17.5 |
/// | < 20        | 16.5 |
/// | < 40        | 15.5 |
/// | < 60        | 14.5 |
/// | ≥ 60        | 13.5 |
///
/// **Usage:**
/// ```dart
/// final zoom = getZoom(speedMph);
/// ```
double getZoom(double speedMph) {
  if (speedMph < 5) return 17.5;
  if (speedMph < 20) return 16.5;
  if (speedMph < 40) return 15.5;
  if (speedMph < 60) return 14.5;
  return 13.5;
}

/// Returns the recommended camera tilt (pitch angle in degrees) for [speedMph].
///
/// A higher tilt gives the driver a more immersive perspective at speed:
///
/// | Speed (mph) | Tilt |
/// |-------------|------|
/// | < 10        |  45° |
/// | < 30        |  55° |
/// | ≥ 30        |  65° |
///
/// **Note:** Camera tilt / 3-D pitch is a Google Maps API feature.  In
/// flutter_map this value is informational only (flutter_map renders a flat
/// 2-D map).  When migrating to a 3-D SDK (e.g. Mapbox) use this value to
/// set the camera pitch directly.
///
/// **Usage:**
/// ```dart
/// final tilt = getTilt(speedMph);
/// ```
double getTilt(double speedMph) {
  if (speedMph < 10) return 45.0;
  if (speedMph < 30) return 55.0;
  return 65.0;
}

/// Computes the look-ahead distance **in metres** that should be used for
/// navigation or map-camera purposes based on the vehicle's current speed.
///
/// [speed] must be supplied in **km/h**.  The threshold value of `5` and the
/// linear coefficients (`120` and `4`) are calibrated for km/h; passing a
/// value in a different unit will produce incorrect results.
///
/// **Logic**
/// - At low speed (< 5 km/h – essentially stopped or manoeuvring) a fixed
///   minimum of **40 m** is used so the driver still has a meaningful preview.
/// - At higher speeds the distance grows linearly:  `120 + speed × 4` metres,
///   keeping the look-ahead window proportional to travel speed.
///
/// **Usage example**
/// ```dart
/// // Inside your navigation update loop:
/// final double speedKmh = currentPosition.speed * 3.6; // convert m/s → km/h
/// final double lookAheadMetres = calculateLookAheadDistance(speedKmh);
/// mapController.animateCamera(
///   CameraUpdate.lookAhead(lookAheadMetres),
/// );
/// ```
///
/// Returns the look-ahead distance in **metres**.
double calculateLookAheadDistance(double speed) {
  return speed < 5 ? 40.0 : 120.0 + speed * 4;
}

/// Projects a new [LatLng] from [origin] at [bearingRad] radians (clockwise
/// from north) by [distanceMeters] along the Earth's surface.
///
/// Uses the haversine/spherical-earth formula with Earth radius 6 371 000 m.
///
/// ### Parameters
/// - [origin]          – Starting point in decimal degrees.
/// - [bearingRad]      – Direction of travel in **radians** (clockwise from
///                       north).  Convert from degrees with `deg * pi / 180`.
/// - [distanceMeters]  – Distance to project, in metres.
///
/// ### Returns
/// The geographic [LatLng] reached after travelling [distanceMeters] from
/// [origin] in the direction [bearingRad].
///
/// ### Example
/// ```dart
/// final ahead = getLookAheadPosition(
///   LatLng(position.latitude, position.longitude),
///   position.heading * pi / 180,
///   lookAheadMeters,
/// );
/// ```
LatLng getLookAheadPosition(
  LatLng origin,
  double bearingRad,
  double distanceMeters,
) {
  const double earthRadius = 6371000.0; // metres
  final double angularDist = distanceMeters / earthRadius;

  final double lat1 = origin.latitude * pi / 180.0;
  final double lng1 = origin.longitude * pi / 180.0;

  final double lat2 = asin(
    sin(lat1) * cos(angularDist) +
        cos(lat1) * sin(angularDist) * cos(bearingRad),
  );

  final double lng2 = lng1 +
      atan2(
        sin(bearingRad) * sin(angularDist) * cos(lat1),
        cos(angularDist) - sin(lat1) * sin(lat2),
      );

  return LatLng(lat2 * 180.0 / pi, lng2 * 180.0 / pi);
}

// ---------------------------------------------------------------------------
// Camera update
// ---------------------------------------------------------------------------

/// Smoothly moves the map camera to follow the driver, throttled to at most
/// one update every **700 ms**.
///
/// ### What it does
/// 1. Skips the update if fewer than 700 ms have elapsed since the last one.
/// 2. Converts `position.speed` (m/s) to mph.
/// 3. Derives [getZoom] and [getTilt] from that speed.
/// 4. Computes a **look-ahead distance** in metres:
///    - `speedMph < 5`  →  40 m  (slow / parked)
///    - `speedMph ≥ 5`  →  `120 + speedMph × 4` m  (highway: ~360–640 m at
///      60–130 mph)
/// 5. Projects a look-ahead geographic target using [getLookAheadPosition].
/// 6. Calls [MapController.moveAndRotate] to animate the camera to the new
///    position, zoom, and bearing.
///
/// ### Parameters
/// - [position]      – Current GPS fix from `geolocator`.  Must have valid
///                     `.speed` (m/s), `.heading` (degrees), `.latitude`, and
///                     `.longitude` fields.
/// - [mapController] – The flutter_map [MapController] that owns the visible
///                     map widget.
///
/// ### Returns
/// The tilt value computed by [getTilt] for the current speed.  flutter_map
/// ignores tilt (2-D only); the return value lets you forward it to a 3-D SDK
/// (Mapbox / Google Maps `CameraPosition.tilt`) without an extra call to
/// [getTilt].  Returns `null` when the update is throttled.
///
/// ### Usage
/// ```dart
/// // Declare a MapController in your State:
/// final MapController _mapController = MapController();
///
/// // Inside your GPS stream listener:
/// updateCamera(position, _mapController);
/// ```
///
/// ### flutter_map vs Google Maps
/// flutter_map renders a flat 2-D map, so camera tilt is not applied.  The
/// equivalent Google Maps call would be:
/// ```dart
/// mapController.animateCamera(
///   CameraUpdate.newCameraPosition(
///     CameraPosition(
///       target: target,
///       zoom: zoom,
///       tilt: tilt,
///       bearing: position.heading,
///     ),
///   ),
/// );
/// ```
double? updateCamera(Position position, MapController mapController) {
  // ── Throttle ──────────────────────────────────────────────────────────────
  final now = DateTime.now();
  if (now.difference(_lastCameraUpdate).inMilliseconds < 700) return null;
  _lastCameraUpdate = now;

  // ── Speed ─────────────────────────────────────────────────────────────────
  // position.speed is in m/s; convert to mph.
  final double speedMph = position.speed * 2.23694;

  // ── Zoom & tilt ───────────────────────────────────────────────────────────
  final double zoom = getZoom(speedMph);
  // tilt is computed per spec and returned so callers can forward it to a
  // 3-D SDK (Mapbox / Google Maps) when available.  flutter_map is 2-D and
  // does not apply it.
  final double tilt = getTilt(speedMph);

  // ── Look-ahead distance (metres) ─────────────────────────────────────────
  final double lookAhead = speedMph < 5 ? 40.0 : 120.0 + speedMph * 4;

  // ── Look-ahead geographic target ──────────────────────────────────────────
  final LatLng target = getLookAheadPosition(
    LatLng(position.latitude, position.longitude),
    position.heading * pi / 180,
    lookAhead,
  );

  // ── Animate camera ────────────────────────────────────────────────────────
  // MapController.moveAndRotate combines pan + zoom + bearing rotation.
  // `tilt` is returned to the caller for use with a 3-D SDK.
  mapController.moveAndRotate(target, zoom, position.heading);

  return tilt;
}
