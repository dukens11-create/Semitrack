import { stopDistanceMeters } from '../../models/stopCoverage';
import { z } from 'zod';
import { DriverError } from '../../errors/driverErrors';
import { Store } from '../../state/Store';
const fixSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  timestamp: z.number().finite(),
  heading: z.number().finite().min(0).max(360).nullable(),
  speed: z.number().finite().nonnegative().nullable(),
});
export type LocationFix = z.infer<typeof fixSchema>;
export interface LocationProvider {
  permissionStatus(): Promise<string>;
  permission(background: boolean): Promise<string>;
  start(background: boolean): Promise<void>;
  stop(): Promise<void>;
  subscribe(
    onFix: (raw: unknown) => void,
    onError: (message: string) => void,
  ): () => void;
}
export type LocationState = {
  tracking: boolean;
  fix: LocationFix | null;
  error?: string;
};
export class LocationService extends Store<LocationState> {
  private unsubscribe?: () => void;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private starting?: Promise<void>;
  private staleTimer?: ReturnType<typeof setInterval>;
  constructor(private provider: LocationProvider) {
    super({ tracking: false, fix: null });
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.catch(() => {});
    return result;
  }
  /** The routing gate and native update filter use the same unchanged limits. */
  getFreshFix(): LocationFix | null {
    const fix = this.value.fix;
    const now = Date.now();
    return fix &&
      now - fix.timestamp <= 15000 &&
      fix.timestamp <= now + 5000 &&
      fix.accuracy <= 100
      ? fix
      : null;
  }
  /** Called only for an explicit location-dependent action, never merely opening Map. */
  requestFreshFix(signal?: AbortSignal): Promise<LocationFix> {
    return new Promise((resolve, reject) => {
      let done = false;
      let ready = false;
      let unsubscribe = () => {};
      const finish = (error?: unknown, fix?: LocationFix) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(fix!);
      };
      const abort = () => finish(new DriverError('REQUEST_CANCELLED'));
      const timer = setTimeout(
        () => finish(new DriverError('GPS_ACQUISITION_TIMEOUT')),
        30000,
      );
      const check = () => {
        if (!ready || done) return;
        const fix = this.getFreshFix();
        if (fix && this.value.tracking) finish(undefined, fix);
        else if (!this.value.tracking)
          finish(new DriverError('GPS_UNAVAILABLE'));
      };
      unsubscribe = this.subscribe(check);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      void (async () => {
        // Recheck Android/iOS permission even when the map retains a previous fix.
        const permission = await this.provider.permissionStatus();
        if (done) return;
        if (permission !== 'granted') await this.start(false, true);
        else if (!this.value.tracking || !this.getFreshFix())
          await this.start(false, false);
        if (done) return;
        ready = true;
        check();
      })().catch(error =>
        finish(
          error instanceof DriverError
            ? error
            : new DriverError('GPS_UNAVAILABLE'),
        ),
      );
    });
  }
  /** Map opening may reuse permission, but must never trigger a permission prompt. */
  startIfPermitted() {
    if (this.starting) return this.starting;
    if (this.value.tracking) return Promise.resolve();
    return this.start(false, false);
  }
  start(background = false, requestPermission = true) {
    const generation = ++this.generation;
    const operation = this.enqueue(async () => {
      if (generation !== this.generation) {
        return;
      }
      await this.stopProvider();
      this.publish({ tracking: false, fix: null });
      const permission = requestPermission
        ? await this.provider.permission(background)
        : await this.provider.permissionStatus();
      if (generation !== this.generation) {
        return;
      }
      if (permission !== 'granted') {
        if (!requestPermission) return;
        throw new DriverError('GPS_PERMISSION_REQUIRED');
      }
      this.unsubscribe = this.provider.subscribe(
        raw => {
          const result = fixSchema.safeParse(raw);
          if (!result.success || generation !== this.generation) {
            return;
          }
          const fix = result.data;
          if (
            Date.now() - fix.timestamp > 15000 ||
            fix.timestamp > Date.now() + 5000 ||
            fix.accuracy > 100 ||
            (this.value.fix && fix.timestamp <= this.value.fix.timestamp)
          ) {
            return;
          }
          const previous = this.value.fix;
          // Reject physically implausible single-fix jumps, allowing both accuracy radii.
          if (
            previous &&
            fix.timestamp - previous.timestamp < 15000 &&
            stopDistanceMeters(
              { lat: previous.latitude, lng: previous.longitude },
              { lat: fix.latitude, lng: fix.longitude },
            ) >
              (60 * (fix.timestamp - previous.timestamp)) / 1000 +
                previous.accuracy +
                fix.accuracy
          )
            return;
          this.publish({
            tracking: true,
            fix: { ...fix, heading: fix.heading === 360 ? 0 : fix.heading },
          });
        },
        providerError => {
          if (generation === this.generation) {
            this.publish({
              tracking: false,
              fix: null,
              error:
                providerError ===
                  'Mock location is not accepted for truck routing.' ||
                providerError ===
                  'Simulated location is not accepted for truck routing.'
                  ? 'Mock or simulated location was rejected. Use real device GPS for truck routing.'
                  : 'Location is unavailable. Check device location settings and retry.',
            });
          }
        },
      );
      this.publish({ tracking: true, fix: null });
      try {
        await this.provider.start(background);
      } catch (error) {
        await this.stopProvider();
        this.publish({ tracking: false, fix: null });
        throw error;
      }
      if (generation !== this.generation) {
        await this.stopProvider();
        return;
      }
      this.staleTimer = setInterval(() => {
        if (this.value.fix && Date.now() - this.value.fix.timestamp > 15000) {
          this.publish({
            ...this.value,
            fix: null,
            error: 'GPS signal is stale. Waiting for a precise fix.',
          });
        }
      }, 5000);
    });
    this.starting = operation;
    const clear = () => {
      if (this.starting === operation) this.starting = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }
  private async stopProvider() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearInterval(this.staleTimer);
    await this.provider.stop();
  }
  stop() {
    ++this.generation;
    return this.enqueue(async () => {
      await this.stopProvider();
      this.publish({ tracking: false, fix: null });
    });
  }
}
