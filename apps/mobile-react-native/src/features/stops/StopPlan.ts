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
export function addStop(plan: StopPlan, stop: Stop): StopPlan {
  if (stop.id === plan.destination.id) {
    throw new Error('An intermediate stop cannot replace the destination.');
  }
  const found = plan.stops.some(item => item.id === stop.id);
  if (!found && plan.stops.length >= 20) {
    throw new Error(
      'A maximum of 20 intermediate stops is supported by the API.',
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
  if (!Array.isArray(plan.stops) || plan.stops.length > 20) throw new Error('Invalid stop count.');
  const ids = new Set([plan.destination.id]);
  for (const stop of plan.stops) {
    valid(stop);
    if (ids.has(stop.id)) throw new Error('Duplicate stop identity.');
    ids.add(stop.id);
  }
}
