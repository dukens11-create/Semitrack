import type { GuidanceDetails } from '../../features/navigation/navigationPresentation';
import type {
  Coordinate,
  TruckProfile,
  TruckRoute,
} from '../../models/contracts';
import type { Stop, StopPlan } from '../../features/stops/StopPlan';
export const GUIDANCE_UNAVAILABLE = 'NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED';
export type NavigationState = {
  phase:
    | 'unavailable'
    | 'idle'
    | 'navigating'
    | 'paused'
    | 'rerouting'
    | 'arrived';
  routeId?: string;
  guidance?: GuidanceDetails;
  maneuverOffset?: number;
  progressObservedAt?: number;
  remainingMeters?: number;
  remainingSeconds?: number;
  speedLimitMph?: number;
};
export type NavigationEvent =
  | { type: 'onGuidanceDetails'; routeId: string; details: GuidanceDetails }
  | { type: 'onNavigationStarted'; routeId: string }
  | { type: 'onLocationUpdate'; coordinate: Coordinate }
  | {
      type: 'onRouteProgress';
      routeId: string;
      remainingMeters: number;
      remainingSeconds: number;
    }
  | {
      type: 'onManeuverChanged';
      routeId: string;
      offset: number;
      distanceMeters: number;
    }
  | { type: 'onInstruction'; text: string }
  | { type: 'onSpeedLimitChanged'; mph: number | null }
  | {
      type: 'onOffRoute' | 'onRerouteStarted' | 'onRerouteCompleted';
      routeId: string;
    }
  | {
      type: 'onRerouteFailed' | 'onNavigationError';
      code: string;
      message: string;
    }
  | { type: 'onIntermediateArrival'; stopId: string }
  | { type: 'onDestinationArrival'; routeId: string };
export interface NavigationEngine {
  initialize(): Promise<{ available: boolean; code?: string }>;
  setTruckProfile(profile: TruckProfile): Promise<void>;
  setRoute(route: TruckRoute, plan: StopPlan): Promise<void>;
  startNavigation(): Promise<void>;
  pauseNavigation(): Promise<void>;
  resumeNavigation(): Promise<void>;
  stopNavigation(): Promise<void>;
  addStop(stop: Stop): Promise<void>;
  removeStop(id: string): Promise<void>;
  reroute(route: TruckRoute, plan: StopPlan): Promise<void>;
  getNavigationState(): NavigationState;
  subscribe(listener: (event: NavigationEvent) => void): () => void;
}
export class GuidanceUnavailableError extends Error {
  readonly code = GUIDANCE_UNAVAILABLE;
  constructor() {
    super(
      'Native commercial guidance is not configured. Truck-route preview is available.',
    );
  }
}

/** No simulated progression, arrival or start-success event. */
export class UnavailableNavigationEngine implements NavigationEngine {
  async initialize() {
    return { available: false, code: GUIDANCE_UNAVAILABLE };
  }
  async setTruckProfile(_profile: TruckProfile) {
    throw new GuidanceUnavailableError();
  }
  async setRoute(_route: TruckRoute, _plan: StopPlan) {
    throw new GuidanceUnavailableError();
  }
  async startNavigation() {
    throw new GuidanceUnavailableError();
  }
  async pauseNavigation() {
    throw new GuidanceUnavailableError();
  }
  async resumeNavigation() {
    throw new GuidanceUnavailableError();
  }
  async stopNavigation() {
    /* Idempotent when no engine exists. */
  }
  async addStop(_stop: Stop) {
    throw new GuidanceUnavailableError();
  }
  async removeStop(_id: string) {
    throw new GuidanceUnavailableError();
  }
  async reroute(_route: TruckRoute, _plan: StopPlan) {
    throw new GuidanceUnavailableError();
  }
  getNavigationState(): NavigationState {
    return { phase: 'unavailable' };
  }
  subscribe(_listener: (event: NavigationEvent) => void) {
    return () => {};
  }
}
