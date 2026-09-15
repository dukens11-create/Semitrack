import { env } from "../config/env.js";
import type { RouteBuildInput, RouteBuildResult } from "../types.js";
import { MapboxRouteProvider } from "./providers/mapboxProvider.js";
import { RoutingProviderError } from "./providers/routeProvider.js";
import { TrimbleRouteProvider } from "./providers/trimbleProvider.js";

const trimble = new TrimbleRouteProvider();
const mapbox = new MapboxRouteProvider();

function logRoute(route: RouteBuildResult, purpose: "selected" | "comparison") {
  console.info(
    `[routing] purpose=${purpose} provider=${route.provider} routeId=${route.selectedRouteId} ` +
    `distanceMiles=${route.distanceMiles} durationSeconds=${route.durationSeconds} alternatives=${route.alternatives.length}`,
  );
}

export function configuredRoutingProviderName() {
  return trimble.name;
}

export async function buildTruckRoute(input: RouteBuildInput) {
  if (env.routingProvider !== "trimble") {
    throw new RoutingProviderError("Trimble", "TRIMBLE_PROVIDER_REQUIRED",
      "Commercial truck routing requires the configured Trimble provider.", 503);
  }
  const provider = trimble;
  const route = await provider.buildRoute(input);
  if (!route.truckSafe || !route.navigationAllowed) {
    throw new RoutingProviderError(
      provider.name,
      "TRUCK_SAFE_ROUTE_UNAVAILABLE",
      `${provider.name} did not return a truck-safe navigable route`,
      422,
    );
  }
  logRoute(route, "selected");
  return route;
}

export async function buildTrafficPreview(input: RouteBuildInput) {
  return mapbox.buildRoute(input);
}

/** Retained endpoint boundary: alternate routing providers can never be enabled. */
export async function compareRoutes(_input: RouteBuildInput): Promise<never> {
  throw new RoutingProviderError(
    "Trimble",
    "ROUTING_COMPARISON_DISABLED",
    "Provider comparison is unavailable. Use the verified Trimble truck route.",
    410,
  );
}
