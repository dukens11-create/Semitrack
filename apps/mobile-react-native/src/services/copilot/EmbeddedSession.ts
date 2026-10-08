import { AppState } from 'react-native';
import { readDeviceLicense, type DeviceLicense } from './DeviceActivation';
import {
  checkEmbeddedSetup,
  EmbeddedSetupError,
  type EmbeddedSetupReport,
} from './EmbeddedSetup';
import {
  observeMapInventory,
  readMapCatalog,
  type MapCatalog,
} from './MapDownloads';

type State = {
  phase: 'idle' | 'restoring' | 'checked' | 'error';
  report: EmbeddedSetupReport | null;
  maps: MapCatalog | null;
  error: string | null;
};
export interface EmbeddedSessionPort {
  read(): Promise<DeviceLicense | null>;
  check(
    value: DeviceLicense,
    signal: AbortSignal,
    options: { requestPermission: boolean; save: boolean },
  ): Promise<EmbeddedSetupReport>;
  maps(): Promise<MapCatalog>;
}
/** One application-wide startup owner. Snapshots contain no credentials. */
export class EmbeddedSession {
  private state: State = {
    phase: 'idle',
    report: null,
    maps: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private mapRead: Promise<void> | null = null;
  private mapReadRevision = 0;
  private foreground = true;
  private revision = 0;
  constructor(private readonly port: EmbeddedSessionPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  ensure(value?: DeviceLicense): Promise<void> {
    if (!this.foreground) return Promise.resolve();
    if (this.running) {
      // A user-supplied identity must not disappear behind an automatic restore.
      // Serialize it so only one native setup check can own startup at a time.
      return value ? this.running.then(() => this.ensure(value)) : this.running;
    }
    const controller = new AbortController();
    this.controller = controller;
    const revision = ++this.revision;
    const current = () =>
      !controller.signal.aborted &&
      this.foreground &&
      revision === this.revision;
    this.publish({ phase: 'restoring', error: null, report: null, maps: null });
    this.running = (async () => {
      try {
        const ids = value ?? (await this.port.read());
        if (!current()) return;
        if (!ids) {
          this.publish({ phase: 'idle' });
          return;
        }
        const report = await this.port.check(ids, controller.signal, {
          requestPermission: !!value,
          save: !!value,
        });
        if (!current()) return;
        this.publish({ phase: 'checked', report });
        await this.refreshMaps();
      } catch (error) {
        if (current())
          this.publish({
            phase: 'error',
            error:
              error instanceof EmbeddedSetupError
                ? error.code
                : 'COPILOT_RESTORE_FAILED',
          });
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  refreshMaps(): Promise<void> {
    if (this.mapRead) {
      // A backgrounded read cannot satisfy a new foreground's inventory check.
      return this.mapReadRevision === this.revision
        ? this.mapRead
        : this.mapRead.then(() => this.refreshMaps());
    }
    if (!this.foreground || !this.state.report?.heavyTruckLicensed)
      return Promise.resolve();
    const revision = this.revision;
    this.mapReadRevision = revision;
    this.mapRead = (async () => {
      try {
        const maps = await this.port.maps();
        if (this.foreground && revision === this.revision)
          this.publish({ maps, error: null });
      } catch {
        if (this.foreground && revision === this.revision)
          this.publish({ maps: null, error: 'COPILOT_STATUS_UNAVAILABLE' });
      }
    })().finally(() => {
      this.mapRead = null;
    });
    return this.mapRead;
  }
  async setForeground(active: boolean) {
    if (active && this.foreground && (this.running || this.state.report)) {
      await (this.running ?? this.refreshMaps());
      return;
    }
    this.foreground = active;
    if (!active) {
      this.controller?.abort();
      ++this.revision;
      this.publish({ report: null, maps: null });
      return;
    }
    if (this.running) await this.running;
    if (this.foreground) await this.ensure();
  }
}
export const embeddedSession = new EmbeddedSession({
  read: readDeviceLicense,
  check: checkEmbeddedSetup,
  maps: readMapCatalog,
});
export function observeEmbeddedSession() {
  const stopInventory = observeMapInventory(() => {
    void embeddedSession.refreshMaps();
  });
  void embeddedSession.setForeground(AppState.currentState === 'active');
  const listener = AppState.addEventListener('change', state => {
    void embeddedSession.setForeground(state === 'active');
  });
  const timer = setInterval(() => {
    void embeddedSession.refreshMaps();
  }, 5000);
  return () => {
    listener.remove();
    stopInventory();
    clearInterval(timer);
    void embeddedSession.setForeground(false);
  };
}
export function embeddedStatus(state: State): string {
  if (state.phase === 'restoring') return 'CoPilot starting…';
  if (state.error) return `CoPilot setup needs attention (${state.error})`;
  if (!state.report?.started) return 'CoPilot provisioning required';
  if (!state.report.fullNavigationLicensed || !state.report.heavyTruckLicensed)
    return 'CoPilot truck license required';
  if (state.maps?.readinessSource === 'WAITING_FOR_LICENSE')
    return 'CoPilot device license verification required';
  if (state.maps?.automationError)
    return `CoPilot map setup needs attention (${state.maps.automationError})`;
  if (!state.maps?.selectedCoverageInstalled)
    return state.maps?.initialAccepted
      ? 'CoPilot maps downloading or installing'
      : 'CoPilot map coverage required';
  return 'CoPilot maps installed · truck guidance verification required';
}
