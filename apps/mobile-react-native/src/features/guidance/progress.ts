import type { TruckRoute } from '../../models/contracts';
/** Future SDK events must refer to the exact active route and an actual mapped maneuver. */
export function acceptManeuver(
  route: TruckRoute,
  routeId: string,
  previousOffset: number,
  offset: number,
): number {
  if (
    routeId !== route.selectedRouteId ||
    offset < previousOffset ||
    !route.turnByTurn.some(item => item.offset === offset)
  ) {
    throw new Error('Stale, backward or unmapped maneuver event.');
  }
  return offset;
}
