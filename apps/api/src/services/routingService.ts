import { recordRoutingOutcome } from './routingCapabilities.js';
import { env } from "../config/env.js";
import type { RouteBuildInput, RouteBuildResult } from "../types.js";
import { RoutingProviderError } from "./providers/routeProvider.js";
import { TrimbleRouteProvider } from "./providers/trimbleProvider.js";

const trimble = new TrimbleRouteProvider();

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
  let route: RouteBuildResult;
  try { route = await provider.buildRoute(input); }
  catch (error) {
    if (error instanceof RoutingProviderError && (error.providerAttempted || error.httpStatus >= 500)) recordRoutingOutcome(error.code);
    throw error;
  }
  if (!route.truckSafe || !route.navigationAllowed) {
    recordRoutingOutcome("TRUCK_SAFE_ROUTE_UNAVAILABLE");
    throw new RoutingProviderError(
      provider.name,
      "TRUCK_SAFE_ROUTE_UNAVAILABLE",
      `${provider.name} did not return a truck-safe navigable route`,
      422,
    );
  }
  recordRoutingOutcome(null);
  logRoute(route, "selected");
  return route;
}

export async function buildTrafficPreview(_input: RouteBuildInput): Promise<never> {
  throw new RoutingProviderError('Trimble', 'PASSENGER_ROUTING_DISABLED', 'Mapbox is available for approved display and geocoding only.', 410);
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
