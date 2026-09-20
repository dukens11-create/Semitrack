import { z } from 'zod';
import { coordinateSchema, type Coordinate } from '../../models/contracts';
import type { Stop } from '../stops/StopPlan';
const responseSchema = z.object({
  features: z.array(
    z
      .object({
        id: z.string().min(1).optional(),
        geometry: z.object({
          type: z.literal('Point'),
          coordinates: z.tuple([
            z.number().finite().min(-180).max(180),
            z.number().finite().min(-90).max(90),
          ]),
        }),
        properties: z.object({
          mapbox_id: z.string().min(1).optional(),
          full_address: z.string().min(1).optional(),
          name: z.string().min(1),
        }),
      })
      .refine(
        item => !!(item.id || item.properties.mapbox_id),
        'Place identity missing',
      ),
  ),
});
/** Temporary geocoding results are used only for the current interaction, not persisted. */
export class SearchService {
  constructor(
    private publicMapToken: string,
    private transport: typeof fetch = fetch,
  ) {}
  async search(
    query: string,
    center?: Coordinate,
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    const text = query.trim();
    if (text.length < 3) return [];
    if (
      text.length > 256 ||
      text.includes(';') ||
      text.split(/\s+/).length > 20
    )
      throw new Error(
        'Use an address of up to 20 words and 256 characters, without semicolons.',
      );
    const params = new URLSearchParams({
      q: text,
      autocomplete: 'true',
      limit: '6',
      country: 'us,ca,mx',
    });
    if (center) {
      const point = coordinateSchema.parse(center);
      params.set('proximity', point.lng + ',' + point.lat);
    }
    return this.request('forward', params, signal);
  }
  async reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<Stop[]> {
    const point = coordinateSchema.parse(coordinate);
    return this.request(
      'reverse',
      new URLSearchParams({
        longitude: String(point.lng),
        latitude: String(point.lat),
        types: 'address',
        limit: '1',
      }),
      signal,
    );
  }
  private async request(
    kind: 'forward' | 'reverse',
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    if (!this.publicMapToken.startsWith('pk.'))
      throw new Error(
        'Address search is unavailable until a public map token is configured.',
      );
    params.set('access_token', this.publicMapToken);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await this.transport(
        'https://api.mapbox.com/search/geocode/v6/' +
          kind +
          '?' +
          params.toString(),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error('Provider unavailable');
      const parsed = responseSchema.parse(await response.json());
      const unique = new Map<string, Stop>();
      for (const item of parsed.features) {
        const id = item.id ?? item.properties.mapbox_id!;
        if (unique.has(id)) continue;
        unique.set(id, {
          id,
          name: item.properties.full_address ?? item.properties.name,
          lng: item.geometry.coordinates[0],
          lat: item.geometry.coordinates[1],
        });
      }
      return [...unique.values()];
    } catch {
      // Fetch exceptions may contain the credential-bearing request URL. Never forward them to UI/logs.
      throw new Error(
        signal?.aborted
          ? 'Search cancelled.'
          : controller.signal.aborted
          ? 'Address search timed out. Try again.'
          : 'Address search is unavailable. Try again.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
