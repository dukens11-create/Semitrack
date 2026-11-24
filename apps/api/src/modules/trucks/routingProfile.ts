import { routingTruckSchema } from './truck.schemas.js';
/** Compare only canonical routing fields, never trust a request's ownership or guessed defaults. */
export function matchesSavedRoutingProfile(saved: unknown, requested: unknown): boolean {
  const a=routingTruckSchema.safeParse(saved), b=routingTruckSchema.safeParse(requested);
  return a.success && b.success && JSON.stringify(a.data)===JSON.stringify(b.data);
}
