import { coPilotHost } from './CoPilotHost';
import { readCoPilotPlaces } from './CoPilotPlaces';
import {
  poiSchema,
  uniquePois,
  type PlaceCategory,
  type Poi,
} from '../../features/poi/PoiService';
import type { Coordinate, TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../location/LocationService';
import { stopDistanceMeters } from '../../models/stopCoverage';
import { DriverError } from '../../errors/driverErrors';
import { freshFix } from '../../features/navigation/navigationPresentation';
import { z } from 'zod';
// Never label generic car parking, repair or car washes as truck facilities.
export const nativePlaceQueries: Record<
  PlaceCategory,
  { category: RegExp; query: string }
> = {
  walmart_store: { category: /^walmart$/i, query: 'Walmart' },
  weigh_station: {
    category: /^weigh(?:ing)? stations?$/i,
    query: 'Weigh Station',
  },
  truck_stop: {
    category: /^truck stops?(?:\s*\/\s*services)?$/i,
    query: 'Truck Stop',
  },
  rest_area: { category: /^rest areas?$/i, query: 'Rest Area' },
  fuel_stop: {
    category: /^(fuel|gas stations?|petrol stations?)$/i,
    query: 'Fuel',
  },
  truck_parking: { category: /^truck parking$/i, query: 'Truck Parking' },
  truck_wash: { category: /^truck wash(?:es)?$/i, query: 'Truck Wash' },
  cat_scale: { category: /^cat scales?$/i, query: 'CAT Scale' },
  truck_repair: {
    category: /^truck (?:repair|services?)(?:\s*\/\s*repair)?$/i,
    query: 'Truck Repair',
  },
};
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    const e = new Error('Search cancelled');
    e.name = 'AbortError';
    throw e;
  }
}
export class CoPilotPoiSearch {
  private tail: Promise<unknown> = Promise.resolve();
  nearby(
    category: PlaceCategory,
    center: Coordinate,
    signal?: AbortSignal,
  ): Promise<Poi[]> {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        checkAbort(signal);
        const host = coPilotHost();
        if (!host.searchNativePois)
          throw new DriverError('COPILOT_POI_UNAVAILABLE');
        const catalog = await readCoPilotPlaces();
        checkAbort(signal);
        const rule = nativePlaceQueries[category];
        const ids = catalog
          .filter(item => rule.category.test(item.name))
          .map(item => item.id);
        let raw: unknown;
        try {
          raw = await host.searchNativePois(
            ids.length ? '' : rule.query,
            ids,
            center.lat,
            center.lng,
          );
        } catch {
          checkAbort(signal);
          throw new DriverError('COPILOT_POI_UNAVAILABLE');
        }
        checkAbort(signal);
        return uniquePois(
          z
            .array(z.unknown())
            .parse(raw)
            .flatMap(item => {
              const parsed = poiSchema.safeParse(item);
              if (!parsed.success || parsed.data.provider !== 'copilot')
                return [];
              const poi = parsed.data;
              // Name-only search must prove the requested specialized facility/brand.
              if (
                !ids.length &&
                !poi.name.toLowerCase().includes(rule.query.toLowerCase())
              )
                return [];
              return [
                {
                  ...poi,
                  category,
                  distanceMeters: stopDistanceMeters(center, {
                    lat: poi.latitude,
                    lng: poi.longitude,
                  }),
                },
              ];
            }),
        ).sort((a, b) => a.distanceMeters! - b.distanceMeters!);
      });
    this.tail = task;
    return task;
  }
  async alongRoute(
    category: PlaceCategory,
    route: TruckRoute,
    fix: LocationFix,
    signal?: AbortSignal,
  ) {
    if (!freshFix(fix) || fix.accuracy > 50)
      throw new DriverError('FRESH_LOCATION_REQUIRED');
    const items = await this.nearby(
      category,
      { lat: fix.latitude, lng: fix.longitude },
      signal,
    );
    checkAbort(signal);
    if (!freshFix(fix)) throw new DriverError('FRESH_LOCATION_REQUIRED');
    return nativePoisAhead(items, route.routeGeometry, fix);
  }
}
/** Advisory geometry filtering of local CoPilot places; never native-route progress or access clearance. */
export function nativePoisAhead(
  items: Poi[],
  geometry: number[][],
  fix: LocationFix,
) {
  if (geometry.length < 2) return [];
  function project(lat: number, lng: number) {
    const scale = Math.cos((lat * Math.PI) / 180) * 111320;
    const hits: { distance: number; offset: number }[] = [];
    let offset = 0;
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1]!,
        b = geometry[i]!;
      const ax = (a[0]! - lng) * scale,
        ay = (a[1]! - lat) * 111320;
      const dx = (b[0]! - a[0]!) * scale,
        dy = (b[1]! - a[1]!) * 111320;
      const length = stopDistanceMeters(
        { lat: a[1]!, lng: a[0]! },
        { lat: b[1]!, lng: b[0]! },
      );
      const t = Math.max(
        0,
        Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
      );
      hits.push({
        distance: Math.hypot(ax + t * dx, ay + t * dy),
        offset: offset + t * length,
      });
      offset += length;
    }
    hits.sort((a, b) => a.distance - b.distance);
    const best = hits[0]!;
    if (
      hits.some(
        hit =>
          hit.distance <= best.distance + 20 &&
          Math.abs(hit.offset - best.offset) > 300,
      )
    )
      return undefined;
    return best;
  }
  const current = project(fix.latitude, fix.longitude);
  if (!current || current.distance > Math.max(50, fix.accuracy * 2)) return [];
  return items
    .flatMap(poi => {
      const position = project(poi.latitude, poi.longitude);
      if (
        !position ||
        position.distance > 2000 ||
        position.offset < current.offset
      )
        return [];
      return [
        {
          ...poi,
          routeDistanceAheadMeters: position.offset - current.offset,
          routeDistanceSource: 'geometry-estimate',
          routeAccessVerified: false,
        },
      ];
    })
    .sort((a, b) => a.routeDistanceAheadMeters - b.routeDistanceAheadMeters);
}
