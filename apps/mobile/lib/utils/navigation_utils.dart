/// Navigation utility functions for camera and map control.
///
/// These helpers translate real-time vehicle telemetry (speed, heading, etc.)
/// into map-camera parameters so the driver always has an appropriate view.
///
/// ### Included utilities
/// - [getTilt] – Returns the camera tilt angle for the given speed.
/// - [calculateLookAheadDistance] – Returns the look-ahead distance in metres.
/// - [smoothBearing] – Filters out sudden heading jumps so the map camera
///   rotates smoothly.
/// - [getZoom] – Returns the appropriate map zoom level for the current
///   vehicle speed.

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

/// Returns a smoothed compass bearing, discarding unrealistically large jumps.
///
/// GPS heading values can occasionally spike by tens of degrees in a single
/// update due to multipath interference or a momentary signal loss.  Passing
/// each new bearing through this function before applying it to the map camera
/// prevents jarring snaps.
///
/// ### Parameters
/// - [newBearing] – The latest raw bearing value from the GPS stream
///   (degrees, 0–360).
/// - [oldBearing] – The bearing that is currently applied to the map camera
///   (degrees, 0–360).
///
/// ### Returns
/// - [newBearing] when the circular difference is ≤ 30° (normal heading
///   change).
/// - [oldBearing] when the circular difference is > 30° (spike – ignored).
///
/// ### Example
/// ```dart
/// // Inside your GPS position-update handler:
/// _currentBearing = smoothBearing(position.heading, _currentBearing);
/// mapController.animateCamera(
///   CameraUpdate.bearingTo(_currentBearing),
/// );
/// ```
double smoothBearing(double newBearing, double oldBearing) {
  final rawDiff = (newBearing - oldBearing).abs();
  // Account for the 0°/360° wraparound so that, e.g., 350°→10° is treated as
  // a 20° change rather than a 340° jump.
  final diff = rawDiff > 180 ? 360 - rawDiff : rawDiff;
  if (diff > 30) return oldBearing; // ignore crazy jumps
  return newBearing;
}

/// Returns the recommended map zoom level for the given vehicle [speed].
///
/// A higher zoom level shows more detail (streets, lane markings) while a
/// lower zoom level shows a wider area ahead – useful at motorway speeds so
/// the driver can see further along the route.
///
/// | Speed (km/h) | Zoom level |
/// |-------------|-----------|
/// | < 5         | 18.8      |
/// | 5 – 19      | 17.8      |
/// | 20 – 39     | 16.8      |
/// | 40 – 64     | 15.8      |
/// | ≥ 65        | 14.8      |
///
/// ### Parameters
/// - [speed] – Current vehicle speed in **km/h**. Must be ≥ 0; an
///   [AssertionError] is thrown in debug mode for negative values.
///
/// ### Returns
/// A [double] zoom level suitable for passing to your map controller's
/// `animateCamera` / `moveCamera` method.
///
/// ### Example
/// ```dart
/// // Inside your GPS position-update handler:
/// final zoom = getZoom(position.speed * 3.6); // m/s → km/h
/// mapController.animateCamera(
///   CameraUpdate.zoomTo(zoom),
/// );
/// ```
double getZoom(double speed) {
  assert(speed >= 0, 'speed must be non-negative, got $speed');
  if (speed < 5) return 18.8;
  if (speed < 20) return 17.8;
  if (speed < 40) return 16.8;
  if (speed < 65) return 15.8;
  return 14.8;
}
