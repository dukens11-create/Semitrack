import { beginRouteDiagnostic, emitRouteDiagnostic, recordRouteFailure } from './routeTelemetry';
import { routeDiagnostic } from './routeDiagnostic';
import { profileFingerprint } from '../truckProfile/equipment';
import { safeDriverError } from '../../errors/driverErrors';
import { Store } from '../../state/Store';
import type {
  Coordinate,
  TruckProfile,
  TruckRoute,
} from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
import type { TruckRoutingService } from '../../services/routing/TruckRoutingService';
export type RouteState = {
  phase: 'idle' | 'calculating' | 'preview' | 'rerouting' | 'error';
  route: TruckRoute | null;
  plan: StopPlan | null;
  error?: string;
  errorCode?: string;
  diagnostic?: ReturnType<typeof routeDiagnostic>;
};
export class RouteStore extends Store<RouteState> {
  private generation = 0;
  private routeProfile: string | null = null;
  private controller: AbortController | null = null;
  constructor(
    private routing: TruckRoutingService,
    private onProfileInvalidated: () => void = () => {},
  ) {
    super({ phase: 'idle', route: null, plan: null });
  }
  clear() {
    ++this.generation;
    this.routeProfile = null;
    this.controller?.abort();
    this.publish({ phase: 'idle', route: null, plan: null });
  }
  async calculate(
    origin: Coordinate,
    plan: StopPlan,
    truck: TruckProfile,
    alternatives = 0,
  ): Promise<boolean> {
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    const attempt = beginRouteDiagnostic(truck, Array.isArray(plan?.stops) ? plan.stops.length + 2 : -1);
    let identity: string;
    try {
      identity = profileFingerprint(truck);
    } catch (error) {
      recordRouteFailure(attempt, 'REQUEST_VALIDATION', error);
      this.clear();
      this.onProfileInvalidated();
      this.publish({
        phase: 'error',
        route: null,
        plan: null,
        error: safeDriverError(error),
        diagnostic: routeDiagnostic(error),
      });
      return false;
    }
    const sameProfile = this.routeProfile === identity;
    const previous = sameProfile
      ? this.value
      : { phase: 'idle' as const, route: null, plan: null };
    this.publish({
      ...previous,
      phase: previous.route ? 'rerouting' : 'calculating',
      error: undefined,
      errorCode: undefined,
      diagnostic: undefined,
    });
    try {
      const route = await this.routing.calculate(
        origin,
        plan,
        truck,
        this.controller.signal,
        alternatives,
        attempt,
      );
      if (generation !== this.generation) {
        return false;
      }
      this.routeProfile = identity;
      this.publish({ phase: 'preview', route, plan });
      return true;
    } catch (error) {
      if (generation === this.generation) {
        const detail = error as { code?: unknown; status?: unknown } | null;
        const invalidProfile =
          detail?.code === 'TRUCK_PROFILE_CHANGED' ||
          detail?.code === 'VERIFIED_TRUCK_REQUIRED';
        const discard =
          invalidProfile || detail?.status === 401 || detail?.status === 403;
        if (invalidProfile) this.onProfileInvalidated();
        if (discard || !sameProfile) this.routeProfile = null;
        emitRouteDiagnostic({attempt,stage:'UI_WARNING',result:'WARNING_OBSERVED',reason:routeDiagnostic(error).code});
        this.publish({
          ...(discard ? { route: null, plan: null } : previous),
          phase: !discard && previous.route ? 'preview' : 'error',
          errorCode: routeDiagnostic(error).code,
          diagnostic: routeDiagnostic(error),
          error: safeDriverError(
            error,
            'Unable to prepare this truck route. Please try again or choose another destination.',
          ),
        });
      }
      return false;
    }
  }
}
