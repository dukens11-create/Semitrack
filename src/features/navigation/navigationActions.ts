import type { StopPlan } from '../stops/StopPlan';
import type { TruckRoute } from '../../models/contracts';
import type { NavigationEngine } from '../../services/guidance/NavigationEngine';
import { isNavigationSession } from './navigationPresentation';

export type ClearRouteResult = { stopAttempted: boolean; stopFailed: boolean };

const NATIVE_STOP_TIMEOUT_MS = 5000;

/**
 * Clear the local planned route immediately, then stop native guidance only when
 * a real navigation session is proven. Local cancellation must never be held
 * hostage by an unavailable/hung native runtime.
 */
export async function clearRouteSession(
  guidance: Pick<NavigationEngine, 'getNavigationState' | 'stopNavigation'>,
  routes: { clear(): void },
): Promise<ClearRouteResult> {
  const state = guidance.getNavigationState();
  const stopAttempted = isNavigationSession(state);

  // This is intentionally first. The driver must be able to leave route mode
  // even if native guidance is unavailable, throws, or does not acknowledge stop.
  routes.clear();

  if (!stopAttempted) return { stopAttempted: false, stopFailed: false };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stopped = await Promise.race([
      guidance.stopNavigation().then(() => true, () => false),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), NATIVE_STOP_TIMEOUT_MS);
      }),
    ]);
    return { stopAttempted: true, stopFailed: !stopped };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function tripShareMessage(
  route: TruckRoute,
  plan: StopPlan,
  metric: boolean,
): string {
  const distance =
    (route.distanceMiles * (metric ? 1.609344 : 1)).toFixed(1) +
    (metric ? ' km' : ' mi');
  const totalMinutes = Math.ceil(route.durationSeconds / 60);
  const duration =
    totalMinutes >= 60
      ? Math.floor(totalMinutes / 60) + 'h ' + (totalMinutes % 60) + 'm'
      : totalMinutes + 'm';
  const stopText = plan.stops.length
    ? `${plan.stops.length} intermediate stop${plan.stops.length === 1 ? '' : 's'}`
    : 'No intermediate stops';
  return [
    'SemiTraX truck route',
    `Destination: ${plan.destination.name}`,
    `Distance: ${distance}`,
    `Estimated duration: ${duration}`,
    stopText,
    'Provider: Trimble',
    'Planning estimate only. Follow posted commercial restrictions and road signs.',
  ].join('\n');
}
