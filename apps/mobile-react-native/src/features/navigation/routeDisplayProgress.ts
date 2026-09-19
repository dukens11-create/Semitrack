import type { TruckRoute } from '../../models/contracts';
/** Geometry split only at an explicit, validated provider maneuver offset; no simulated motion. */
export function routeDisplayProgress(
  route: TruckRoute | null,
  offset: number | undefined,
) {
  if (
    !route ||
    offset === undefined ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= route.routeGeometry.length ||
    !route.turnByTurn.some(m => m.offset === offset)
  )
    return null;
  let leg = 0;
  for (let i = 0; i < route.legs.length; i++) {
    const first = route.legs[i]?.maneuvers[0];
    if (first && first.offset <= offset) leg = i;
  }
  return {
    traveled: route.routeGeometry.slice(0, offset + 1),
    remaining: route.routeGeometry.slice(offset),
    legNumber: route.legs.length ? leg + 1 : undefined,
    legCount: route.legs.length || undefined,
  };
}
