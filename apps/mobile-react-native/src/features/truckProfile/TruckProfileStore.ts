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
  private session = 0;
  // Confirmation is deliberately session-local. Never trust a legacy default as verified.
  private confirmed: { id: string; fingerprint: string } | null = null;
  constructor(private api: ApiClient, private onChange: () => void) {
    super({ profiles: [], selected: null });
  }
  async load() {
    const generation = ++this.generation;
    let profiles: TruckProfile[];
    try {
      const data = z.object({ items: z.array(truckSchema).max(1000) }).parse(await this.api.request('GET', '/trucks'));
      profiles = data.items;
    } catch (error) {
      if (generation === this.generation) this.invalidate();
      throw error;
    }
    if (generation !== this.generation) return;
    const selected =
      profiles.find(
        item =>
          item.id === this.confirmed?.id &&
          isServerVerifiedTruck(item) &&
          profileFingerprint(item) === this.confirmed.fingerprint,
      ) ?? null;
    if (!selected) this.confirmed = null;
    const changed =
      this.value.selected &&
      (!selected ||
        profileFingerprint(this.value.selected) !==
          profileFingerprint(selected));
    this.publish({ profiles, selected });
    if (changed) this.onChange();
  }
  async save(profile: TruckProfile): Promise<TruckProfile> {
    verifyRoutingProfile(profile);
    const session = this.session;
    if (profile.id === this.value.selected?.id) this.invalidate();
    const saved = truckSchema.parse(
      await this.api.request(
        profile.id ? 'PATCH' : 'POST',
        '/trucks' + (profile.id ? '/' + encodeURIComponent(profile.id) : ''),
        profile.id ? { ...serializeTruck(profile), expectedRevision: profile.revision } : serializeTruck(profile),
      ),
    );
    if (session !== this.session)
      throw new Error('Session changed. Sign in and review the profile again.');
    this.onChange();
    await this.load();
    return saved;
  }
  async select(reviewed: TruckProfile) {
    verifyRoutingProfile(reviewed);
    const fingerprint = profileFingerprint(reviewed);
    const current = this.value.profiles.find(item => item.id === reviewed.id);
    if (!current || !reviewed.revision || current.revision !== reviewed.revision || profileFingerprint(current) !== fingerprint)
      throw new Error(
        'Truck profile changed. Review its current values before using it.',
      );
    const session = this.session;
    this.invalidate();
    await this.api.request(
      'POST',
      '/trucks/' + encodeURIComponent(reviewed.id) + '/verify',
      { expectedRevision: reviewed.revision },
    );
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
    this.confirmed=null;
    ++this.generation;
    this.publish({...this.value,selected:null});
  }
  private invalidate() {
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
    ++this.session;
    ++this.generation;
    this.confirmed = null;
    this.publish({ profiles: [], selected: null });
  }
}
