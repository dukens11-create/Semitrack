import type { TruckProfile, TruckRoute } from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
import type {
  NavigationEngine,
  NavigationState,
} from '../../services/guidance/NavigationEngine';

const running = (state: NavigationState) =>
  ['navigating', 'paused', 'rerouting', 'arrived'].includes(state.phase);
/** Serializes native commands. Cancellation invalidates startup before awaiting native cleanup. */
export class GuidanceSession {
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private started: boolean;
  private suppressed = false;
  constructor(private engine: NavigationEngine) {
    this.started = running(engine.getNavigationState());
  }
  get acceptsEvents() {
    return !this.suppressed;
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }
  start(
    route: TruckRoute,
    plan: StopPlan,
    truck: TruckProfile,
    current: () => boolean,
  ) {
    const generation = ++this.generation;
    const valid = () => generation === this.generation && current();
    return this.enqueue(
      async (): Promise<
        'started' | 'unavailable' | 'cancelled' | 'stop-unconfirmed'
      > => {
        if (!valid()) return 'cancelled';
        if (this.started) return 'stop-unconfirmed';
        this.suppressed = false;
        const capability = await this.engine.initialize();
        if (!valid()) return 'cancelled';
        if (!capability.available) return 'unavailable';
        await this.engine.setTruckProfile(truck);
        if (!valid()) return 'cancelled';
        await this.engine.setRoute(route, plan);
        if (!valid()) return 'cancelled';
        await this.engine.startNavigation();
        this.started = true;
        // A late native start must be stopped even if the route changed outside Cancel.
        if (!valid()) {
          this.suppressed = true;
          return (await this.stopStarted()) ? 'cancelled' : 'stop-unconfirmed';
        }
        return 'started';
      },
    );
  }
  pauseOrResume() {
    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation || this.suppressed) return;
      const state = this.engine.getNavigationState();
      if (state.phase === 'paused') await this.engine.resumeNavigation();
      else if (state.phase === 'navigating')
        await this.engine.pauseNavigation();
    });
  }
  /** No license check, and no stop command for a session that never started. */
  cancel() {
    ++this.generation;
    this.suppressed = true;
    return this.enqueue(() => this.stopStarted());
  }
  private async stopStarted(): Promise<boolean> {
    if (!this.started) return true;
    try {
      await this.engine.stopNavigation();
      this.started = false;
      return true;
    } catch {
      // Do not claim native guidance stopped; block future start until cleanup succeeds.
      return false;
    }
  }
}
