import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { env } from "../../config/env.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(1));
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
      `&geometries=geojson&steps=true&overview=full&annotations=duration,distance,speed`;

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
      routeGeometry: (route.geometry?.coordinates ?? []) as number[][],
      turnByTurn: (leg.steps ?? []).slice(0, 10).map((s: any, index: number) => ({
        step: index + 1,
        instruction: s.maneuver?.instruction ?? "Continue",
        distanceMiles: metersToMiles(s.distance ?? 0),
      })),
      alerts: [
        "Mapbox live traffic route calculated",
        "Mapbox driving-traffic profile used",
      ],
    };
  }
}
