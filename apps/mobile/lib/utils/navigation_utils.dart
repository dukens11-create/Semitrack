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
