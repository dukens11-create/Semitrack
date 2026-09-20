import { z } from 'zod';
import type { ApiClient } from '../../services/api/ApiClient';
import { Store } from '../../state/Store';
export const settingsSchema = z.object({
  voiceEnabled: z.boolean(),
  voiceMuted: z.boolean(),
  voiceLocale: z.string().trim().min(2).max(20),
  units: z.enum(['imperial', 'metric']),
  dayNightMode: z.enum(['system', 'day', 'night']),
  trafficReroute: z.boolean(),
  settingsJson: z.record(z.unknown()).nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsState = {
  settings: Settings | null;
  phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  error?: string;
};
/** One account-scoped observable source for retained screens and map preferences. */
export class SettingsService extends Store<SettingsState> {
  private generation = 0;
  private deviceAppearance: Settings['dayNightMode'] | null = null;
  /** Explicit device selection is authoritative; remote defaults cannot overwrite it. */
  setDeviceAppearance(mode: Settings['dayNightMode'] | null) {
    if (!mode) return;
    this.deviceAppearance = mode;
    if (this.value.settings)
      this.publish({
        ...this.value,
        settings: { ...this.value.settings, dayNightMode: mode },
      });
  }
  private loadFlight: Promise<Settings | null> | null = null;
  constructor(
    private api: ApiClient,
    private retainAppearance?: (
      mode: Settings['dayNightMode'],
    ) => Promise<void>,
    private retainOffline?: (settings: Settings) => Promise<void>,
  ) {
    super({ settings: null, phase: 'idle' });
  }
  clear() {
    ++this.generation;
    this.loadFlight = null;
    this.publish({ settings: null, phase: 'idle' });
  }
  load(force = false): Promise<Settings | null> {
    if (this.value.phase === 'saving')
      return Promise.resolve(this.value.settings);
    if (!force && this.value.settings)
      return Promise.resolve(this.value.settings);
    if (this.loadFlight) return this.loadFlight;
    const generation = ++this.generation;
    this.publish({ ...this.value, phase: 'loading', error: undefined });
    const flight = this.fetchSettings(generation).finally(() => {
      if (this.loadFlight === flight) this.loadFlight = null;
    });
    this.loadFlight = flight;
    return flight;
  }
  private async fetchSettings(generation: number) {
    try {
      const remote = settingsSchema.parse(
        await this.api.request('GET', '/navigation-settings'),
      );
      const settings = {
        ...remote,
        dayNightMode: this.deviceAppearance ?? remote.dayNightMode,
      };
      if (generation !== this.generation) return null;
      await this.retainAppearance?.(settings.dayNightMode);
      if (generation === this.generation)
        this.deviceAppearance = settings.dayNightMode;
      if (generation !== this.generation) return null;
      await this.retainOffline?.(settings).catch(() => {});
      if (generation !== this.generation) return null;
      this.publish({ settings, phase: 'ready' });
      return settings;
    } catch (error) {
      if (generation !== this.generation) return null;
      this.publish({
        ...this.value,
        phase: 'error',
        error: 'Could not load preferences. Retry when connected.',
      });
      throw error;
    }
  }
  async save(input: Settings): Promise<Settings | null> {
    const body = settingsSchema.parse(input);
    if (this.value.phase === 'saving')
      throw new Error('Preferences are already being saved.');
    const generation = ++this.generation;
    this.loadFlight = null;
    this.publish({ ...this.value, phase: 'saving', error: undefined });
    try {
      await this.retainAppearance?.(body.dayNightMode);
      if (generation !== this.generation) return null;
      if (this.retainAppearance) this.setDeviceAppearance(body.dayNightMode);
      const remote = settingsSchema.parse(
        await this.api.request('PUT', '/navigation-settings', body),
      );
      const settings = { ...remote, dayNightMode: body.dayNightMode };
      if (generation !== this.generation) return null;
      this.setDeviceAppearance(settings.dayNightMode);
      await this.retainOffline?.(settings).catch(() => {});
      if (generation !== this.generation) return null;
      this.publish({ settings, phase: 'ready' });
      return settings;
    } catch (error) {
      if (generation !== this.generation) return null;
      this.publish({
        ...this.value,
        phase: 'error',
        error: this.retainAppearance
          ? 'Some preferences could not sync. A successfully saved appearance choice stays active on this device.'
          : 'Preferences were not saved. Retry when connected.',
      });
      throw error;
    }
  }
}
