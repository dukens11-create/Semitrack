import type { TruckRoute } from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
const label = (value: string) => value.replace(/[\r\n\t]+/g, ' ').slice(0, 120);
/** Driver-initiated OS share sheet only. No GPS coordinate, credential, or live tracking link. */
export function shareRouteSummary(route: TruckRoute, plan: StopPlan): string {
  return [
    'SemiTraX truck route planning summary',
    ...plan.stops.map((stop, i) => i + 1 + '. ' + label(stop.name)),
    'Destination: ' + label(plan.destination.name),
    route.distanceMiles.toFixed(1) +
      ' miles · ' +
      Math.ceil(route.durationSeconds / 60) +
      ' minutes (provider planning estimate)',
    'Not live tracking or confirmation of active navigation.',
  ].join('\n');
}
