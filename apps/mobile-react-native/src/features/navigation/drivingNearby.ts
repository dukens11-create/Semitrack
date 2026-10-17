import type { Poi, PlaceCategory } from '../poi/PoiService';
import type { LocationFix } from '../../services/location/LocationService';
import { freshFix } from './navigationPresentation';
import { stopDistanceMeters } from '../../models/stopCoverage';
export const drivingCategories = [
  'truck_stop',
  'weigh_station',
  'rest_area',
] as const;
export type NearbyCategory = (typeof drivingCategories)[number];
export type NearbyBatch = {
  items: Poi[];
  observedAt: number;
  latitude: number;
  longitude: number;
  failed?: boolean;
};
export type NearbyCache = Partial<Record<NearbyCategory, NearbyBatch>>;
export function visibleNearby(
  cache: NearbyCache,
  fix: LocationFix | null,
  now: number,
) {
  const rows: {
    category: PlaceCategory;
    slot: number;
    poi?: Poi;
    miles?: number;
    status: string;
  }[] = [];
  for (const category of drivingCategories) {
    const batch = cache[category];
    const fresh = freshFix(fix, now) && !!fix;
    const valid =
      fresh &&
      batch &&
      !batch.failed &&
      now >= batch.observedAt &&
      now - batch.observedAt <= 120000 &&
      stopDistanceMeters(
        { lat: fix.latitude, lng: fix.longitude },
        { lat: batch.latitude, lng: batch.longitude },
      ) <= 3218.688;
    const items = valid
      ? batch.items
          .filter(
            poi =>
              poi.category === category &&
              Number.isFinite(poi.latitude) &&
              Number.isFinite(poi.longitude),
          )
          .map(poi => ({
            poi,
            miles:
              stopDistanceMeters(
                { lat: fix.latitude, lng: fix.longitude },
                { lat: poi.latitude, lng: poi.longitude },
              ) / 1609.344,
          }))
          .sort((a, b) => a.miles - b.miles)
      : [];
    for (let slot = 0; slot < (category === 'truck_stop' ? 2 : 1); slot++) {
      rows.push({
        category,
        slot,
        ...items[slot],
        status: !fresh
          ? 'Waiting for GPS'
          : batch?.failed
          ? 'Unavailable'
          : valid
          ? 'Not found nearby'
          : 'Finding nearby…',
      });
    }
  }
  return rows;
}
export function drivingHeading(fix: LocationFix | null, now: number) {
  if (
    !freshFix(fix, now) ||
    fix?.heading == null ||
    !Number.isFinite(fix.heading) ||
    fix.heading < 0 ||
    fix.heading > 360
  )
    return undefined;
  const degrees = fix.heading % 360;
  return {
    degrees,
    label: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
      Math.round(degrees / 45) % 8
    ]!,
  };
}
/** Accept only explicit provider metadata. Never infer an exit from location or nearby maneuvers. */
export function providerExit(poi?: Poi) {
  if (!poi || typeof poi.exitSource !== 'string' || !poi.exitSource.trim())
    return undefined;
  const value = String(poi.exitNumber ?? '').trim();
  return /^\d{1,4}[A-Za-z]?$/.test(value) ? value.toUpperCase() : undefined;
}
