import type { TruckRoute } from '../../models/contracts';
import type {
  NavigationEvent,
  NavigationState,
} from '../../services/guidance/NavigationEngine';
import { guidanceDetailsSchema } from './navigationPresentation';
/** Enrich presentation from real engine events, never change the engine's phase or route identity. */
export function applyGuidanceEvent(
  previous: NavigationState,
  current: NavigationState,
  event: NavigationEvent,
  route: TruckRoute | null,
  now = Date.now(),
): NavigationState {
  if (
    !route ||
    current.routeId !== route.selectedRouteId ||
    current.phase !== 'navigating'
  )
    return { ...current, guidance: undefined };
  if (
    previous.routeId === current.routeId &&
    previous.phase === 'navigating' &&
    previous.progressObservedAt !== undefined &&
    now - previous.progressObservedAt >= 0 &&
    now - previous.progressObservedAt <= 15000 &&
    current.progressObservedAt === undefined
  ) {
    current = {
      ...current,
      remainingMeters: previous.remainingMeters,
      remainingSeconds: previous.remainingSeconds,
      progressObservedAt: previous.progressObservedAt,
    };
  }
  const data = guidanceDetailsSchema.safeParse(
    current.guidance ??
      (previous.routeId === current.routeId ? previous.guidance : undefined),
  );
  let guidance =
    data.success &&
    now - data.data.observedAt >= 0 &&
    now - data.data.observedAt <= 15000
      ? data.data
      : undefined;
  if ('routeId' in event && event.routeId !== current.routeId)
    return { ...current, guidance };
  const valid = (n: number) => Number.isFinite(n) && n >= 0;
  if (
    event.type === 'onRouteProgress' &&
    valid(event.remainingMeters) &&
    valid(event.remainingSeconds)
  )
    return {
      ...current,
      guidance,
      remainingMeters: event.remainingMeters,
      remainingSeconds: event.remainingSeconds,
      progressObservedAt: now,
    };
  if (event.type === 'onManeuverChanged' && !valid(event.distanceMeters))
    return { ...current, guidance: undefined };
  if (event.type === 'onManeuverChanged' && valid(event.distanceMeters)) {
    const maneuver = route.turnByTurn.find(m => m.offset === event.offset);
    if (maneuver) {
      current = { ...current, maneuverOffset: event.offset };
      guidance = {
        source: 'copilot',
        observedAt: now,
        instruction: maneuver.instruction,
        action: maneuver.action ?? maneuver.direction,
        currentRoad: maneuver.currentRoadName,
        nextRoad: maneuver.nextRoadName ?? maneuver.roadName,
        exit: maneuver.exitNumber,
        maneuverMeters: event.distanceMeters,
      };
    } else guidance = undefined;
  }
  if (event.type === 'onInstruction' && event.text.trim())
    guidance = {
      source: 'copilot',
      observedAt: now,
      instruction: event.text.trim(),
    };
  if (event.type === 'onSpeedLimitChanged') {
    // A speed-limit update must not refresh a stale maneuver's timestamp.
    if (
      event.mph === null ||
      !Number.isFinite(event.mph) ||
      event.mph <= 0 ||
      event.mph > 150
    )
      guidance = guidance
        ? { ...guidance, speedLimitMph: undefined }
        : undefined;
    else if (Number.isFinite(event.mph) && event.mph > 0 && event.mph <= 150)
      guidance = {
        source: 'copilot',
        observedAt: now,
        speedLimitMph: event.mph,
      };
  }
  if (event.type === 'onGuidanceDetails') {
    const parsed = guidanceDetailsSchema.safeParse(event.details);
    guidance =
      parsed.success &&
      parsed.data.observedAt <= now &&
      now - parsed.data.observedAt <= 15000
        ? parsed.data
        : undefined;
  }
  return { ...current, guidance };
}
