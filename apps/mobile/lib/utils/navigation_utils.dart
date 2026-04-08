/// Navigation utility helpers for map/camera heading management.
///
/// Import this file wherever you need to smooth out GPS bearing noise before
/// applying it to a map camera or compass widget:
///
/// ```dart
/// import 'package:semitrack/utils/navigation_utils.dart';
/// ```
library navigation_utils;

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
