import { env } from "../../config/env.js";
import type { RouteBuildInput, RouteBuildResult, RouteLeg, RouteOption } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(2));
}
function decodePolyline6(encoded: string): number[][] {
  const coordinates: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coordinates.push([lng / 1e6, lat / 1e6]);
  }
  return coordinates;
}

function parseRoute(route: any, index: number): RouteOption {
  let maneuverIndex = 0;
  const legs: RouteLeg[] = (Array.isArray(route.legs) ? route.legs : []).map((leg: any) => ({
    distanceMiles: metersToMiles(Number(leg.distance ?? 0)),
    durationSeconds: Number(leg.duration ?? 0),
    geometry: [],
    maneuvers: (Array.isArray(leg.steps) ? leg.steps : []).map((step: any) => ({
      step: ++maneuverIndex,
      instruction: String(step.maneuver?.instruction ?? "Continue"),
      distanceMiles: metersToMiles(Number(step.distance ?? 0)),
      durationSeconds: Number(step.duration ?? 0),
      action: step.maneuver?.type ? String(step.maneuver.type) : undefined,
      direction: step.maneuver?.modifier ? String(step.maneuver.modifier) : undefined,
      roadName: step.name ? String(step.name) : undefined,
      exitNumber: step.exits ? String(step.exits) : undefined,
      lanes: Array.isArray(step.intersections)
        ? step.intersections.flatMap((intersection: any) =>
            Array.isArray(intersection.lanes)
              ? intersection.lanes.map((lane: any) => ({
                  directions: Array.isArray(lane.indications) ? lane.indications.map(String) : [],
                  active: lane.active === true || lane.valid === true,
                }))
              : [],
          )
        : undefined,
    })),
  }));
  const durationSeconds = Number(route.duration ?? legs.reduce((sum, leg) => sum + leg.durationSeconds, 0));
  return {
    id: String(route.routeIndex ?? `mapbox-route-${index}`),
    distanceMiles: metersToMiles(Number(route.distance ?? 0)),
    etaMinutes: Math.ceil(durationSeconds / 60),
    durationSeconds,
    routeGeometry: decodePolyline6(String(route.geometry ?? "")),
    legs,
    turnByTurn: legs.flatMap((leg) => leg.maneuvers),
    notices: [],
  };
}

export class MapboxRouteProvider implements RouteProvider {
  readonly name = "Mapbox" as const;

  async buildRoute(input: RouteBuildInput): Promise<RouteBuildResult> {
    if (!env.mapboxToken) throw new Error("MAPBOX_TOKEN is not configured");
    const coordinates = [
      `${input.origin.lng},${input.origin.lat}`,
      ...(input.viaStops ?? []).map((stop) => `${stop.lng},${stop.lat}`),
      `${input.destination.lng},${input.destination.lat}`,
    ].join(";");
    const exclude = input.truck.avoidFerries ? "&exclude=ferry" : "";
    const alternatives = (input.alternatives ?? 0) > 0 ? "true" : "false";
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}` +
      `?access_token=${encodeURIComponent(env.mapboxToken)}` +
      `&geometries=polyline6&steps=true&overview=full&annotations=duration,distance,speed,congestion_numeric` +
      `&alternatives=${alternatives}${exclude}`;
    const response = await fetch(url);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Mapbox traffic preview failed (${response.status}): ${detail}`);
    }
    const data: any = await response.json();
    const routes = Array.isArray(data.routes) ? data.routes.map(parseRoute) : [];
    if (!routes.length) throw new Error("Mapbox returned no route");
    const selected = routes[0];
    return {
      provider: "Mapbox",
      truckSafe: false,
      navigationAllowed: false,
      trafficAware: true,
      calculatedAt: new Date().toISOString(),
      selectedRouteId: selected.id,
      distanceMiles: selected.distanceMiles,
      etaMinutes: selected.etaMinutes,
      durationSeconds: selected.durationSeconds,
      routeGeometry: selected.routeGeometry,
      legs: selected.legs,
      turnByTurn: selected.turnByTurn,
      alternatives: routes.slice(1),
      alerts: [
        "NON-TRUCK-SAFE PREVIEW: Mapbox driving-traffic does not enforce the selected commercial-truck dimensions or restrictions.",
        "Navigation is blocked for this route.",
      ],
    };
  }
}
