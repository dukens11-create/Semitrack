/// Navigation utility functions for camera and map control.
///
/// These helpers translate real-time vehicle telemetry (speed, heading, etc.)
/// into map-camera parameters so the driver always has an appropriate view.

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
