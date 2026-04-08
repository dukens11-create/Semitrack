/// Navigation utility functions for map camera and heading control.
///
/// These helpers are intended for use in the navigation UI layer (e.g.
/// `TruckMapScreen`) wherever the map camera must react to live GPS data.
///
/// ### Included utilities
/// - [smoothBearing] – Filters out sudden heading jumps so the map camera
///   rotates smoothly.
/// - [getZoom] – Returns the appropriate map zoom level for the current
///   vehicle speed, giving drivers a wider view at highway speeds and a
///   close-up view in slow / stop-and-go traffic.

// ---------------------------------------------------------------------------
// Bearing smoothing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Speed-based zoom
// ---------------------------------------------------------------------------

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
