import { env } from "../config/env.js";
import type { RouteBuildInput } from "../types.js";
import { HereRouteProvider } from "./providers/hereProvider.js";
import { MapboxRouteProvider } from "./providers/mapboxProvider.js";

const here = new HereRouteProvider();
const mapbox = new MapboxRouteProvider();

export async function buildRoute(input: RouteBuildInput) {
  return env.routeProvider === "mapbox"
    ? mapbox.buildRoute(input)
    : here.buildRoute(input);
}

export async function compareRoutes(input: RouteBuildInput) {
  const [hereRoute, mapboxRoute] = await Promise.all([
    here.buildRoute(input),
    mapbox.buildRoute(input),
  ]);

  return {
    selectedProvider: env.routeProvider,
    here: hereRoute,
    mapbox: mapboxRoute,
  };
}
