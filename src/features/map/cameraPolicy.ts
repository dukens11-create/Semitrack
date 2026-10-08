import type { LocationFix } from '../../services/location/LocationService';
import { freshFix } from '../navigation/navigationPresentation';
export function normalizeHeading(heading: number | null) {
  return heading !== null && Number.isFinite(heading)
    ? ((heading % 360) + 360) % 360
    : 0;
}
export function cameraPolicy(
  fix: LocationFix | null,
  active: boolean,
  maneuverMeters?: number,
  now = Date.now(),
  autoZoom = true,
) {
  if (!freshFix(fix, now) || !fix) return null;
  const moving = fix.speed !== null && fix.speed >= 1.5;
  const nearTurn =
    active &&
    maneuverMeters !== undefined &&
    Number.isFinite(maneuverMeters) &&
    maneuverMeters >= 0 &&
    maneuverMeters < 250;
  return {
    centerCoordinate: [fix.longitude, fix.latitude],
    zoomLevel: !autoZoom
      ? 15
      : nearTurn
      ? 17
      : active && fix.speed !== null && fix.speed > 22
      ? 14
      : 15,
    heading: active && moving ? normalizeHeading(fix.heading) : 0,
    pitch: active ? 45 : 0,
    animationDuration: 700,
  };
}
