/// Navigation utility functions for camera and map control.
///
/// These helpers translate real-time vehicle telemetry (speed, heading, etc.)
/// into map-camera parameters so the driver always has an appropriate view.
///
/// Import this file wherever you need camera or bearing utilities:
///
/// ```dart
/// import 'package:semitrack/utils/navigation_utils.dart';
/// ```
library navigation_utils;

/// Returns the recommended camera/map tilt angle (in degrees) for the given
/// vehicle [speed] in **km/h**.
///
/// [speed] must be ≥ 0. Passing a negative value is undefined behaviour;
/// callers should clamp raw sensor data before invoking this function.
///
/// The tilt value controls how steeply the map is pitched toward the horizon,
/// giving a more immersive 3-D perspective at higher speeds:
///
/// | Speed (km/h) | Tilt |
/// |--------------|------|
/// | < 10         | 45°  |
/// | 10 – 29      | 55°  |
/// | ≥ 30         | 65°  |
///
/// Example usage in a Mapbox camera-update callback:
/// ```dart
/// void _onSpeedChanged(double currentSpeedKmh) {
///   final tilt = getTilt(currentSpeedKmh.clamp(0, double.infinity));
///   _mapboxMap.easeTo(
///     CameraOptions(pitch: tilt),
///     MapAnimationOptions(duration: 300),
///   );
/// }
/// ```
double getTilt(double speed) {
  if (speed < 10) return 45;
  if (speed < 30) return 55;
  return 65;
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

/// Maximum heading delta (in degrees) that [smoothBearing] will accept.
///
/// Changes larger than this threshold are treated as GPS noise and rejected.
/// Raise the value (e.g. `45`) for pedestrian use or lower it (e.g. `15`) for
/// smooth highway driving.
const double kBearingSmoothingThreshold = 30.0;

/// Returns a smoothed bearing by ignoring abrupt heading jumps larger than
/// [kBearingSmoothingThreshold] degrees.
///
/// GPS receivers—especially at low speed or on initial fix—can emit noisy
/// heading values that cause the map camera to spin erratically.  This function
/// acts as a simple gate filter: only heading deltas of **≤ 30°** are accepted;
/// larger deltas are treated as measurement noise and the previous bearing is
/// kept instead.
///
/// ### Parameters
/// - [newBearing]  The latest bearing (in degrees, 0–360) reported by the GPS
///   or sensor.
/// - [oldBearing]  The bearing that is currently applied to the map/camera.
///
/// ### Returns
/// - [newBearing] when `|newBearing − oldBearing| ≤ 30°`  (smooth update).
/// - [oldBearing] when the difference exceeds 30°            (ignore the jump).
///
/// ### Usage example
/// ```dart
/// double _currentBearing = 0;
///
/// void _onLocationUpdate(Position position) {
///   _currentBearing = smoothBearing(position.heading, _currentBearing);
///   _mapController.animateCamera(
///     CameraUpdate.bearingTo(_currentBearing),
///   );
/// }
/// ```
///
/// ### Notes
/// - Bearing values are compared as raw doubles; the function does **not**
///   handle wrap-around (e.g. 350° → 10° would be seen as a 340° jump and
///   ignored).  If you need wrap-aware smoothing, normalise the difference to
///   the −180…180 range first.
/// - The 30° threshold is intentionally conservative.  Adjust the constant to
///   suit your use-case (e.g. a tighter 15° for smooth highway driving or a
///   looser 45° for pedestrian use).
double smoothBearing(double newBearing, double oldBearing) {
  final diff = (newBearing - oldBearing).abs();
  if (diff > kBearingSmoothingThreshold) return oldBearing; // ignore crazy jumps
  return newBearing;
}
