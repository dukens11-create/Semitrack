import { MAX_INTERMEDIATE_STOPS } from '../../models/routeLimits';
import { coordinateSchema, type Coordinate } from '../../models/contracts';
export type Stop = Readonly<Coordinate & { id: string; name: string }>;
export type StopPlan = Readonly<{ destination: Stop; stops: readonly Stop[] }>;
function valid(stop: Stop) {
  coordinateSchema.parse(stop);
  if (!stop.id || !stop.name) {
    throw new Error('Stop ID and name required.');
  }
  return Object.freeze({ ...stop });
}
export function createStopPlan(destination: Stop): StopPlan {
  return { destination: valid(destination), stops: [] };
}
/** Append after the existing destination; keep the API's viaStops + destination model. */
export function appendDestination(plan: StopPlan, stop: Stop): StopPlan {
  validateStopPlan(plan);
  const next = {
    destination: valid(stop),
    stops: [...plan.stops, plan.destination],
  };
  validateStopPlan(next);
  return next;
}
/** Edit the complete ordered list, promoting the last remaining stop when needed. */
export function removeRouteStop(plan: StopPlan, id: string): StopPlan {
  validateStopPlan(plan);
  const ordered = [...plan.stops, plan.destination];
  if (!ordered.some(stop => stop.id === id)) throw new Error('Stop missing.');
  const remaining = ordered.filter(stop => stop.id !== id);
  if (!remaining.length)
    throw new Error('Use Cancel Route to remove the last destination.');
  return {
    destination: remaining[remaining.length - 1]!,
    stops: remaining.slice(0, -1),
  };
}
export function reorderRouteStop(
  plan: StopPlan,
  from: number,
  to: number,
): StopPlan {
  validateStopPlan(plan);
  const ordered = [...plan.stops, plan.destination];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= ordered.length ||
    to >= ordered.length
  ) {
    throw new Error('Invalid stop order.');
  }
  const [stop] = ordered.splice(from, 1);
  ordered.splice(to, 0, stop!);
  return {
    destination: ordered[ordered.length - 1]!,
    stops: ordered.slice(0, -1),
  };
}
export function addStop(plan: StopPlan, stop: Stop): StopPlan {
  if (stop.id === plan.destination.id) {
    throw new Error('An intermediate stop cannot replace the destination.');
  }
  const found = plan.stops.some(item => item.id === stop.id);
  if (!found && plan.stops.length >= MAX_INTERMEDIATE_STOPS) {
    throw new Error(
      `A maximum of ${MAX_INTERMEDIATE_STOPS} intermediate stops is supported.`,
    );
  }
  return {
    ...plan,
    stops: found
      ? plan.stops.map(item => (item.id === stop.id ? valid(stop) : item))
      : [...plan.stops, valid(stop)],
  };
}
export function removeStop(plan: StopPlan, id: string): StopPlan {
  return { ...plan, stops: plan.stops.filter(stop => stop.id !== id) };
}
export function reorderStop(
  plan: StopPlan,
  from: number,
  to: number,
): StopPlan {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= plan.stops.length ||
    to >= plan.stops.length
  ) {
    throw new Error('Invalid stop order.');
  }
  const stops = [...plan.stops];
  const [stop] = stops.splice(from, 1);
  if (!stop) {
    throw new Error('Stop missing.');
  }
  stops.splice(to, 0, stop);
  return { ...plan, stops };
}
export function intermediateArrival(plan: StopPlan, id: string): StopPlan {
  if (plan.stops[0]?.id !== id) {
    throw new Error('Arrival must match the next remaining stop.');
  }
  return { ...plan, stops: plan.stops.slice(1) };
}

/** Validate the complete runtime boundary, including plans not made by UI helpers. */
export function validateStopPlan(plan: StopPlan): void {
  valid(plan.destination);
  if (!Array.isArray(plan.stops) || plan.stops.length > MAX_INTERMEDIATE_STOPS)
    throw new Error('Invalid stop count.');
  const ids = new Set([plan.destination.id]);
  for (const stop of plan.stops) {
    valid(stop);
    if (ids.has(stop.id)) throw new Error('Duplicate stop identity.');
    ids.add(stop.id);
  }
}
