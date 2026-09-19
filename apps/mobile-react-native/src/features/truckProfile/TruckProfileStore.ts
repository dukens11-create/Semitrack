import NativePlatform from '../../native/navigation/NativeSemiTraxPlatform';
import { DriverError } from '../../errors/driverErrors';
import { z } from 'zod';
import { Store } from '../../state/Store';
import {
  truckSchema,
  isServerVerifiedTruck,
  serializeTruck,
  type TruckProfile,
} from '../../models/contracts';
import type { ApiClient } from '../../services/api/ApiClient';
import { profileFingerprint, verifyRoutingProfile } from './equipment';
export class TruckProfileStore extends Store<{
  profiles: TruckProfile[];
  selected: TruckProfile | null;
}> {
  private generation = 0;
  private canRestoreDefault = true;
  private session = 0;
  // Reload verification from the authenticated server; a legacy default is not evidence.
  private confirmed: { id: string; fingerprint: string } | null = null;
  private pendingCreates = new Map<string, Promise<string>>();
  constructor(
    private api: ApiClient,
    private onChange: () => void,
    private newOperation: () => Promise<string> = async () => {
      if (!NativePlatform) throw new DriverError('NATIVE_MODULE_UNAVAILABLE');
      return NativePlatform.createOperationId();
    },
  ) {
    super({ profiles: [], selected: null });
  }
  async load() {
    const generation = ++this.generation;
    let profiles: TruckProfile[];
    try {
      const response = await this.api.request('GET', '/trucks');
      if (generation !== this.generation) return;
      const data = z
        .object({ items: z.array(truckSchema).max(1000) })
        .parse(response);
      profiles = data.items;
    } catch (error) {
      if (generation === this.generation) this.invalidate();
      throw error;
    }
    if (generation !== this.generation) return;
    const verifiedDefaults = profiles.filter(item => {
      if (!isServerVerifiedTruck(item)) return false;
      try {
        verifyRoutingProfile(item);
        return true;
      } catch {
        return false;
      }
    });
    const selected =
      profiles.find(
        item =>
          item.id === this.confirmed?.id &&
          isServerVerifiedTruck(item) &&
          profileFingerprint(item) === this.confirmed.fingerprint,
      ) ??
      (this.canRestoreDefault && verifiedDefaults.length === 1
        ? verifiedDefaults[0]!
        : null);
    this.canRestoreDefault = false;
    this.confirmed = selected
      ? { id: selected.id, fingerprint: profileFingerprint(selected) }
      : null;
    const changed =
      this.value.selected &&
      (!selected ||
        profileFingerprint(this.value.selected) !==
          profileFingerprint(selected));
    this.publish({ profiles, selected });
    if (changed) this.onChange();
  }
  async prepareCreate(profile: TruckProfile): Promise<TruckProfile> {
    if (profile.id || profile.createOperationId) return profile;
    const key = profileFingerprint(profile);
    let pending = this.pendingCreates.get(key);
    if (!pending) {
      pending = this.newOperation();
      this.pendingCreates.set(key, pending);
    }
    try {
      return {
        ...profile,
        createOperationId: z
          .string()
          .uuid()
          .parse(await pending),
      };
    } catch (error) {
      this.pendingCreates.delete(key);
      throw error;
    }
  }
  async save(profile: TruckProfile): Promise<TruckProfile> {
    verifyRoutingProfile(profile);
    const session = this.session;
    const submitted = await this.prepareCreate(profile);
    if (session !== this.session) throw new DriverError('SESSION_CHANGED');
    if (profile.id === this.value.selected?.id) this.invalidate();
    const saved = truckSchema.parse(
      await this.api.request(
        profile.id ? 'PATCH' : 'POST',
        '/trucks' + (profile.id ? '/' + encodeURIComponent(profile.id) : ''),
        profile.id
          ? { ...serializeTruck(profile), expectedRevision: profile.revision }
          : {
              ...serializeTruck(profile),
              createOperationId: submitted.createOperationId,
            },
      ),
    );
    if (session !== this.session)
      throw new Error('Session changed. Sign in and review the profile again.');
    this.pendingCreates.delete(profileFingerprint(profile));
    this.onChange();
    // Retain a successful POST identity even if the later verification refresh fails.
    ++this.generation;
    const profiles = this.value.profiles.filter(item => item.id !== saved.id);
    this.publish({ profiles: [...profiles, saved], selected: null });
    return saved;
  }
  async select(reviewed: TruckProfile) {
    verifyRoutingProfile(reviewed);
    const fingerprint = profileFingerprint(reviewed);
    const selectionSession = this.session;
    await this.load();
    if (selectionSession !== this.session)
      throw new DriverError('SESSION_CHANGED');
    const current = this.value.profiles.find(item => item.id === reviewed.id);
    if (
      !current ||
      !reviewed.revision ||
      current.revision !== reviewed.revision ||
      profileFingerprint(current) !== fingerprint
    )
      throw new DriverError('TRUCK_PROFILE_CHANGED');
    const session = this.session;
    this.invalidate();
    try {
      await this.api.request(
        'POST',
        '/trucks/' + encodeURIComponent(reviewed.id) + '/verify',
        { expectedRevision: reviewed.revision },
      );
    } catch (error) {
      if ((error as { status?: number })?.status === 409) {
        await this.load();
        throw new DriverError('TRUCK_PROFILE_CHANGED');
      }
      throw error;
    }
    if (session !== this.session)
      throw new Error('Session changed. Review the profile again.');
    this.confirmed = { id: reviewed.id, fingerprint };
    await this.load();
    if (!this.value.selected || this.value.selected.id !== reviewed.id)
      throw new Error(
        'The saved profile changed or could not be verified. Review it again.',
      );
  }
  invalidateFromRouting() {
    this.canRestoreDefault = false;
    this.confirmed = null;
    ++this.generation;
    this.publish({ ...this.value, selected: null });
  }
  private invalidate() {
    this.canRestoreDefault = false;
    this.confirmed = null;
    ++this.generation;
    this.publish({ ...this.value, selected: null });
    this.onChange();
  }
  async delete(id: string) {
    const session = this.session;
    if (id === this.value.selected?.id) this.invalidate();
    await this.api.request('DELETE', '/trucks/' + encodeURIComponent(id));
    if (session !== this.session) return;
    this.onChange();
    await this.load();
  }
  clear() {
    this.canRestoreDefault = true;
    ++this.session;
    this.pendingCreates.clear();
    ++this.generation;
    this.confirmed = null;
    this.publish({ profiles: [], selected: null });
  }
}
