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
] as const;
export type PlaceCategory = (typeof placeCategories)[number];
export const poiSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().optional(),
    category: z.string().optional(),
    provider: z.string().optional(),
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
    return data.items.flatMap(item => {
      const result = poiSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
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
  ): Promise<Record<string, unknown>[]> {
    const data = z.object({ items: z.array(z.record(z.unknown())) }).parse(
      await this.api.request('POST', '/safety/' + kind + '/corridor', {
        route: route.routeGeometry.map(([lng, lat]) => ({ lat, lng })),
        currentRouteOffsetMeters,
        maxDistanceAheadMeters: 160934,
        limit: 50,
      }),
    );
    return data.items;
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
