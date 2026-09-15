import { matchItemsToRoute } from "../safetyDataService.js";
import { env } from "../../config/env.js";
import {
  parseHerePlaces,
  type HerePlace,
  type HerePlaceCategory,
} from "./herePlacesParser.js";

export type { HerePlace, HerePlaceCategory } from "./herePlacesParser.js";

type Coordinate = { lat: number; lng: number };

const queryByCategory: Record<HerePlaceCategory, string> = {
  walmart_store: "Walmart",
  weigh_station: "truck weigh station",
  truck_stop: "truck stop",
  rest_area: "highway rest area",
  fuel_stop: "truck diesel fuel",
  truck_parking: "truck parking",
  truck_wash: "truck wash",
  cat_scale: "CAT Scale",
  truck_repair: "heavy duty truck repair",
};
export async function searchHerePlaces(input: {
  category: HerePlaceCategory;
  center: Coordinate;
  radiusMeters?: number;
  limit?: number;
}): Promise<HerePlace[]> {
  if (!env.hereApiKey) throw new Error("HERE_API_KEY is not configured");
  const radiusMeters = Math.min(Math.max(input.radiusMeters ?? 50_000, 100), 100_000);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const params = new URLSearchParams({
    in: `circle:${input.center.lat},${input.center.lng};r=${radiusMeters}`,
    q: queryByCategory[input.category],
    limit: String(limit),
    apiKey: env.hereApiKey,
  });
  const response = await fetch(`https://discover.search.hereapi.com/v1/discover?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HERE place search failed (${response.status})`);
  }
  return parseHerePlaces(await response.json(), input.category);
}

function sampleRoute(route: Coordinate[], maxSamples = 12): Coordinate[] {
  if (route.length <= maxSamples) return route;
  const result: Coordinate[] = [];
  for (let index = 0; index < maxSamples; index += 1) {
    const sourceIndex = Math.round((index * (route.length - 1)) / (maxSamples - 1));
    const point = route[sourceIndex];
    if (point) result.push(point);
  }
  return result;
}

export async function searchHerePlacesAlongRoute(input: {
  category: HerePlaceCategory;
  route: Coordinate[];
  radiusMeters?: number;
  maxResults?: number;
  currentRouteOffsetMeters?: number;
}): Promise<HerePlace[]> {
  const samples = sampleRoute(input.route);
  const batches = await Promise.all(
    samples.map((center) => searchHerePlaces({
      category: input.category,
      center,
      radiusMeters: input.radiusMeters ?? 25_000,
      limit: 20,
    })),
  );
  const unique = new Map<string, HerePlace>();
  for (const place of batches.flat()) unique.set(place.id, place);
  // Filter and rank all bounded provider candidates before applying the requested limit.
  return matchItemsToRoute(input.route, [...unique.values()], place => ({lat: place.latitude, lng: place.longitude}),
    2500, input.currentRouteOffsetMeters ?? 0)
    .slice(0, Math.min(Math.max(input.maxResults ?? 100, 1), 250))
    .map(match => {
      const {distanceMeters: _distance, ...place} = match.item;
      return {...place, routeDistanceAheadMeters: match.routeOffsetMeters - (input.currentRouteOffsetMeters ?? 0),
        detourOffsetMeters: match.distanceFromRouteMeters};
    });
}