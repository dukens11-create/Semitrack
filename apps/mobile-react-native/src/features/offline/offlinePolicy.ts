import type { LocationFix } from '../../services/location/LocationService';
import { freshFix } from '../navigation/navigationPresentation';
export const OFFLINE_DISPLAY_NOTICE =
  'Offline Mapbox display only. Downloads do not provide offline truck routing, CoPilot maps, live traffic, POIs or guidance.';
export function offlineBounds(
  fix: LocationFix | null,
  now = Date.now(),
): [number[], number[]] {
  if (
    !freshFix(fix, now) ||
    !fix ||
    Math.abs(fix.latitude) > 80 ||
    Math.abs(fix.longitude) > 179
  )
    throw new Error(
      'A fresh GPS fix away from polar/date-line boundaries is required.',
    );
  // Small, explicit 5 km radius display region; no route or truck access inference.
  const lat = 5000 / 111320,
    lng = lat / Math.cos((fix.latitude * Math.PI) / 180);
  return [
    [fix.longitude + lng, fix.latitude + lat],
    [fix.longitude - lng, fix.latitude - lat],
  ];
}
