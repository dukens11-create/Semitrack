/// Navigation utility functions for driving/routing assistance.

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
