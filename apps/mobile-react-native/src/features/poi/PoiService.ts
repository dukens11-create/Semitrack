import type { LocationFix } from '../../services/location/LocationService';
import { z } from 'zod';
import type { ApiClient } from '../../services/api/ApiClient';
import type { Coordinate, TruckRoute } from '../../models/contracts';
export const placeCategories = [
  'walmart_store',
  'weigh_station',
  'truck_stop',
  'rest_area',
  'fuel_stop',
  'truck_parking',
  'truck_wash',
  'cat_scale',
  'truck_repair',
] as const;
export type PlaceCategory = (typeof placeCategories)[number];
export const poiSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().optional(),
    category: z.string().optional(),
    provider: z.string().optional(),
    distanceMeters: z.number().finite().nonnegative().optional(),
    routeDistanceAheadMeters: z.number().finite().nonnegative().optional(),
  })
  .passthrough();
export type Poi = z.infer<typeof poiSchema>;
export class PoiService {
  constructor(private api: ApiClient) {}
  async nearby(
    category: PlaceCategory,
    center: Coordinate,
    signal?: AbortSignal,
  ): Promise<Poi[]> {
    const params = new URLSearchParams({
      category,
      lat: String(center.lat),
      lng: String(center.lng),
      limit: '30',
    });
    const data = z
      .object({ items: z.array(z.unknown()) })
      .parse(
        await this.api.request(
          'GET',
          '/places/search?' + params.toString(),
          undefined,
          signal,
        ),
      );
    return uniquePois(
      data.items.flatMap(item => {
        const result = poiSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    );
  }
  async alongRoute(
    category: PlaceCategory,
    route: TruckRoute,
    fix: LocationFix,
    signal?: AbortSignal,
  ): Promise<Poi[]> {
    const data = z.object({ items: z.array(z.unknown()) }).parse(
      await this.api.request(
        'POST',
        '/places/corridor',
        {
          category,
          route: route.routeGeometry.map(([lng, lat]) => ({ lat, lng })),
          currentLocation: {
            lat: fix.latitude,
            lng: fix.longitude,
            accuracy: fix.accuracy,
            timestamp: fix.timestamp,
          },
        },
        signal,
      ),
    );
    return uniquePois(
      data.items.flatMap(item => {
        const result = poiSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    );
  }
  async corridor(
    kind:
      | 'restrictions'
      | 'road-events'
      | 'cameras'
      | 'parking'
      | 'fuel'
      | 'weigh-stations',
    route: TruckRoute,
    currentRouteOffsetMeters = 0,
    fix?: LocationFix,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const data = z.object({ items: z.array(z.record(z.unknown())) }).parse(
      await this.api.request(
        'POST',
        '/safety/' + kind + '/corridor',
        {
          route: route.routeGeometry.map(([lng, lat]) => ({ lat, lng })),
          currentRouteOffsetMeters,
          ...(fix
            ? {
                currentLocation: {
                  lat: fix.latitude,
                  lng: fix.longitude,
                  accuracy: fix.accuracy,
                  timestamp: fix.timestamp,
                },
              }
            : {}),
          maxDistanceAheadMeters: 160934,
          limit: 50,
        },
        signal,
      ),
    );
    return data.items;
  }
  async routeWeather(
    route: TruckRoute,
    fix: LocationFix,
    signal?: AbortSignal,
  ) {
    return z.object({ items: z.array(z.record(z.unknown())) }).parse(
      await this.api.request(
        'POST',
        '/weather/route',
        {
          route: route.routeGeometry.map(([lng, lat]) => ({ lat, lng })),
          currentLocation: {
            lat: fix.latitude,
            lng: fix.longitude,
            accuracy: fix.accuracy,
            timestamp: fix.timestamp,
          },
        },
        signal,
      ),
    ).items;
  }
  report(
    type: string,
    entityId: string,
    value: string,
    position: Coordinate,
    numericValue?: number,
  ) {
    return this.api.request('POST', '/safety/community-reports', {
      type,
      entityId,
      value,
      latitude: position.lat,
      longitude: position.lng,
      ...(numericValue !== undefined ? { numericValue } : {}),
    });
  }
}

/** Provider identity wins; near-identical names/coordinates coalesce without merging distinct businesses. */
export function uniquePois(items: Poi[]): Poi[] {
  const ids = new Set<string>(),
    locations = new Set<string>();
  return items
    .filter(item => {
      const key = [
        item.provider ?? '',
        item.name.trim().toLowerCase(),
        item.latitude.toFixed(5),
        item.longitude.toFixed(5),
      ].join('|');
      if (ids.has(item.id) || locations.has(key)) return false;
      ids.add(item.id);
      locations.add(key);
      return true;
    })
    .sort(
      (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
    );
}

export function reportedDieselCandidates(
  items: Record<string, unknown>[],
  now = Date.now(),
): Poi[] {
  const candidates: Poi[] = [];
  for (const station of items) {
    const prices = Array.isArray(station.prices) ? station.prices : [];
    const observation = prices.find(raw => {
      if (!raw || typeof raw !== 'object') return false;
      const p = raw as Record<string, unknown>,
        price = Number(p.cashPrice);
      const age = now - Date.parse(String(p.observedAt));
      return (
        p.fuelType === 'DIESEL' &&
        p.currency === 'USD' &&
        p.unit === 'US_GALLON' &&
        p.verified === true &&
        typeof p.source === 'string' &&
        p.source.length > 0 &&
        Number.isFinite(price) &&
        price > 0 &&
        age >= 0 &&
        age <= 86400000 &&
        Date.parse(String(p.expiresAt)) > now
      );
    }) as Record<string, unknown> | undefined;
    if (!observation) continue;
    const parsed = poiSchema.safeParse({ ...station, category: 'fuel_stop' });
    if (parsed.success)
      candidates.push({
        ...parsed.data,
        reportedCashPrice: Number(observation.cashPrice),
        priceSource: observation.source,
        priceObservedAt: observation.observedAt,
      });
  }
  return uniquePois(candidates).sort(
    (a, b) => Number(a.reportedCashPrice) - Number(b.reportedCashPrice),
  );
}
