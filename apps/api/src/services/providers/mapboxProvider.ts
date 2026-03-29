import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { env } from "../../config/env.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(1));
}

/**
 * Decodes a Mapbox polyline6-encoded geometry string into [lng, lat] pairs.
 * polyline6 uses a precision factor of 1e6 (vs 1e5 for standard polyline5).
 */
function decodePolyline6(encoded: string): number[][] {
  const coordinates: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    // Store as [lng, lat] to match GeoJSON / existing routeGeometry convention.
    coordinates.push([lng / 1e6, lat / 1e6]);
  }

  return coordinates;
}

export class MapboxRouteProvider implements RouteProvider {
  async buildRoute(input: RouteBuildInput): Promise<RouteBuildResult> {
    const coords = [
      `${input.origin.lng},${input.origin.lat}`,
      ...(input.viaStops ?? []).map((s) => `${s.lng},${s.lat}`),
      `${input.destination.lng},${input.destination.lat}`,
    ].join(";");

    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
      `?access_token=${encodeURIComponent(env.mapboxToken)}` +
      `&geometries=polyline6&steps=true&overview=full&annotations=duration,distance,speed` +
      `&exclude=ferry`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mapbox route failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const route = data.routes?.[0];
    const leg = route?.legs?.[0];
    if (!route || !leg) throw new Error("Mapbox route missing data");

    return {
      provider: "Mapbox",
      distanceMiles: metersToMiles(route.distance ?? 0),
      etaMinutes: Math.round((route.duration ?? 0) / 60),
      routeGeometry: decodePolyline6(route.geometry ?? ""),
      turnByTurn: (leg.steps ?? []).slice(0, 10).map((s: any, index: number) => ({
        step: index + 1,
        instruction: s.maneuver?.instruction ?? "Continue",
        distanceMiles: metersToMiles(s.distance ?? 0),
      })),
      alerts: [
        "Mapbox live traffic route calculated",
        "Mapbox driving-traffic profile used",
        "Route may include interstates/highways and avoids ferries",
      ],
    };
  }
}
