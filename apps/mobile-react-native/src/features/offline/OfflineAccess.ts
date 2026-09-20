import { z } from 'zod';
import type { TokenVault } from '../../services/storage/TokenVault';
import type { Settings } from '../settings/SettingsService';

export const OFFLINE_VIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const preferencesSchema = z.object({
  units: z.enum(['imperial', 'metric']),
  dayNightMode: z.enum(['day', 'night', 'system']),
  temperatureUnit: z.enum(['F', 'C']),
}).strict();
const recordSchema = z.object({
  version: z.literal(1),
  owner: z.string().min(1).max(200),
  // Binding is protected by the same device-unlocked vault as the session.
  // It is compared only, never used to authenticate, exposed to UI, or logged.
  sessionBinding: z.string().min(1).max(8192),
  verifiedAt: z.number().finite().nonnegative(),
  preferences: preferencesSchema.nullable(),
  preferencesSavedAt: z.number().finite().nonnegative().nullable(),
}).strict();
type Record = z.infer<typeof recordSchema>;
export type OfflineView = Readonly<{
  verifiedAt: number;
  expiresAt: number;
  preferences: z.infer<typeof preferencesSchema> | null;
  preferencesSavedAt: number | null;
}>;
export interface OfflineRecordVault {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}
/** A read-only preference snapshot, never an authentication or entitlement cache. */
export class OfflineAccess {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(
    private vault: OfflineRecordVault,
    private session: TokenVault,
    private now: () => number = Date.now,
  ) {}
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.catch(() => {});
    return result;
  }
  private async record(): Promise<Record | null> {
    const raw = await this.vault.read();
    if (!raw || raw.length > 12000) return null;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
  clear(): Promise<void> {
    ++this.generation;
    return this.serialized(() => this.vault.clear());
  }
  /** Only call after a validated online account response, not a cached identity. */
  confirm(owner: string): Promise<void> {
    const generation = this.generation;
    return this.serialized(async () => {
      const session = await this.session.read();
      if (!session || generation !== this.generation) return;
      const previous = await this.record().catch(() => null);
      const verifiedAt = this.now();
      const retain = previous?.owner === owner &&
        previous.verifiedAt <= verifiedAt &&
        verifiedAt - previous.verifiedAt < OFFLINE_VIEW_MAX_AGE_MS;
      const next = recordSchema.parse({
        version: 1, owner, sessionBinding: session.refreshToken, verifiedAt,
        preferences: retain ? previous.preferences : null,
        preferencesSavedAt: retain ? previous.preferencesSavedAt : null,
      });
      if (generation === this.generation)
        await this.vault.write(JSON.stringify(next));
    });
  }
  savePreferences(owner: string, settings: Settings): Promise<void> {
    const generation = this.generation;
    return this.serialized(async () => {
      const record = await this.record();
      const session = await this.session.read();
      const now = this.now();
      if (!record || !session || record.owner !== owner ||
          record.sessionBinding !== session.refreshToken ||
          generation !== this.generation || now < record.verifiedAt ||
          now - record.verifiedAt >= OFFLINE_VIEW_MAX_AGE_MS) return;
      // Never persist settingsJson: it can contain recent addresses or other data.
      const preferences = preferencesSchema.parse({
        units: settings.units, dayNightMode: settings.dayNightMode,
        temperatureUnit: settings.settingsJson?.rnTemperatureUnit === 'C' ? 'C' : 'F',
      });
      await this.vault.write(JSON.stringify({...record, preferences, preferencesSavedAt: now}));
    });
  }
  read(): Promise<OfflineView | null> {
    const generation = this.generation;
    return this.serialized(async () => {
      try {
        const record = await this.record();
        const session = await this.session.read();
        const now = this.now();
        if (!record || !session || record.sessionBinding !== session.refreshToken ||
            generation !== this.generation || now < record.verifiedAt ||
            now - record.verifiedAt >= OFFLINE_VIEW_MAX_AGE_MS ||
            (record.preferencesSavedAt !== null && record.preferencesSavedAt > now)) return null;
        return {
          verifiedAt: record.verifiedAt,
          expiresAt: record.verifiedAt + OFFLINE_VIEW_MAX_AGE_MS,
          preferences: record.preferences,
          preferencesSavedAt: record.preferencesSavedAt,
        };
      } catch {
        // Malformed/locked storage cannot grant offline access or disclose data.
        return null;
      }
    });
  }
}
