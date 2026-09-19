import { z } from 'zod';
import type { TruckRoute } from '../../models/contracts';
import type { NavigationState } from '../../services/guidance/NavigationEngine';
import type { LocationFix } from '../../services/location/LocationService';

// Only the licensed engine may populate this route-bound, timestamped payload.
export const guidanceDetailsSchema = z.object({
  source: z.literal('copilot'),
  observedAt: z.number().finite(),
  instruction: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  currentRoad: z.string().trim().min(1).optional(),
  nextRoad: z.string().trim().min(1).optional(),
  highway: z.string().trim().min(1).optional(),
  exit: z.string().trim().min(1).optional(),
  toward: z.string().trim().min(1).optional(),
  subsequent: z.string().trim().min(1).optional(),
  maneuverMeters: z.number().finite().nonnegative().optional(),
  speedLimitMph: z.number().finite().positive().max(150).optional(),
  lanes: z
    .array(
      z.object({
        directions: z.array(z.string().trim().min(1)).min(1),
        recommended: z.boolean(),
      }),
    )
    .min(1)
    .max(12)
    .optional(),
  junction: z
    .object({
      label: z.string().trim().min(1),
      directions: z.array(z.string().trim().min(1)).min(1),
    })
    .optional(),
});
export type GuidanceDetails = z.infer<typeof guidanceDetailsSchema>;
export function isNavigationSession(state: NavigationState) {
  return ['navigating', 'paused', 'rerouting', 'arrived'].includes(state.phase);
}
export function freshFix(fix: LocationFix | null, now = Date.now()) {
  return (
    !!fix &&
    Number.isFinite(fix.timestamp) &&
    now - fix.timestamp <= 15000 &&
    fix.timestamp <= now + 5000 &&
    fix.accuracy <= 100
  );
}
export function navigationPresentation(
  route: TruckRoute | null,
  state: NavigationState,
  fix: LocationFix | null,
  now = Date.now(),
) {
  if (!route) return null;
  const live =
    isNavigationSession(state) && state.routeId === route.selectedRouteId;
  const parsed = guidanceDetailsSchema.safeParse(state.guidance);
  const guidance =
    live &&
    state.phase === 'navigating' &&
    parsed.success &&
    now - parsed.data.observedAt >= 0 &&
    now - parsed.data.observedAt <= 15000
      ? parsed.data
      : undefined;
  const valid = (v: number | undefined) =>
    v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;
  const progressFresh =
    live &&
    state.progressObservedAt !== undefined &&
    now - state.progressObservedAt >= 0 &&
    now - state.progressObservedAt <= 15000;
  return {
    mode: live ? state.phase : 'preview',
    guidance,
    remainingMeters: progressFresh ? valid(state.remainingMeters) : undefined,
    remainingSeconds: progressFresh ? valid(state.remainingSeconds) : undefined,
    speedMps:
      freshFix(fix, now) && fix?.speed !== null ? valid(fix?.speed) : undefined,
    gpsFresh: freshFix(fix, now),
  };
}
export function distanceText(meters: number, metric: boolean) {
  return metric
    ? meters < 1000
      ? Math.round(meters) + ' m'
      : (meters / 1000).toFixed(1) + ' km'
    : (meters / 1609.344).toFixed(1) + ' mi';
}
