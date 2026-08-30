import { env } from "../config/env.js";
import type { RouteBuildInput, RouteBuildResult } from "../types.js";
import { HereRouteProvider } from "./providers/hereProvider.js";
import { MapboxRouteProvider } from "./providers/mapboxProvider.js";
import type { RouteProvider } from "./providers/routeProvider.js";
import { RoutingProviderError } from "./providers/routeProvider.js";
import { TrimbleRouteProvider } from "./providers/trimbleProvider.js";

const here = new HereRouteProvider();
const trimble = new TrimbleRouteProvider();
const mapbox = new MapboxRouteProvider();

const truckProviders: Record<"here" | "trimble", RouteProvider> = { here, trimble };

function selectedTruckProvider() {
  return truckProviders[env.routingProvider];
}

function logRoute(route: RouteBuildResult, purpose: "selected" | "comparison") {
  console.info(
    `[routing] purpose=${purpose} provider=${route.provider} routeId=${route.selectedRouteId} ` +
    `distanceMiles=${route.distanceMiles} durationSeconds=${route.durationSeconds} alternatives=${route.alternatives.length}`,
  );
}

function majorHighways(route: RouteBuildResult) {
  const values = route.turnByTurn.flatMap((maneuver) => [
    maneuver.roadName,
    maneuver.currentRoadName,
    maneuver.nextRoadName,
    maneuver.instruction,
  ]).filter((value): value is string => Boolean(value));
  const patterns = [
    /\bI-?\s?\d{1,3}[A-Z]?\b/gi,
    /\bUS-?\s?\d{1,3}[A-Z]?\b/gi,
    /\b(?:SR|SH)-?\s?\d{1,3}[A-Z]?\b/gi,
    /\b(?:Interstate|U\.S\. Route|State Route)\s+\d{1,3}[A-Z]?\b/gi,
  ];
  const matches = values.flatMap((value) => patterns.flatMap((pattern) => value.match(pattern) ?? []));
  return [...new Set(matches.map((value) => value.replace(/\s+/g, " ").trim()))].slice(0, 50);
}

function comparisonSummary(route: RouteBuildResult) {
  return {
    provider: route.provider,
    mileage: route.distanceMiles,
    etaMinutes: route.etaMinutes,
    durationSeconds: route.durationSeconds,
    geometryPointCount: route.routeGeometry.length,
    routeGeometry: route.routeGeometry,
    truckRestrictionNotices: route.alerts,
    majorHighways: majorHighways(route),
    route,
  };
}

function reason(result: PromiseSettledResult<RouteBuildResult>) {
  if (result.status === "fulfilled") return null;
  if (result.reason instanceof RoutingProviderError) {
    return {
      code: result.reason.code,
      message: result.reason.message,
      retryable: result.reason.retryable,
    };
  }
  return { code: "ROUTING_PROVIDER_ERROR", message: String(result.reason), retryable: false };
}

export function configuredRoutingProviderName() {
  return selectedTruckProvider().name;
}

export async function buildTruckRoute(input: RouteBuildInput) {
  const provider = selectedTruckProvider();
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

export async function compareRoutes(input: RouteBuildInput) {
  if (!env.routingCompareEnabled) {
    throw new RoutingProviderError(
      "Trimble",
      "ROUTING_COMPARISON_DISABLED",
      "HERE/Trimble route comparison is disabled. Set ROUTING_COMPARE_ENABLED=true for development or testing.",
      403,
    );
  }

  const [hereResult, trimbleResult] = await Promise.allSettled([
    here.buildRoute(input),
    trimble.buildRoute(input),
  ]);
  const hereRoute = hereResult.status === "fulfilled" ? hereResult.value : null;
  const trimbleRoute = trimbleResult.status === "fulfilled" ? trimbleResult.value : null;
  if (hereRoute) logRoute(hereRoute, "comparison");
  if (trimbleRoute) logRoute(trimbleRoute, "comparison");
  if (!hereRoute && !trimbleRoute) {
    throw new RoutingProviderError(
      "Trimble",
      "ROUTING_COMPARISON_UNAVAILABLE",
      "Neither HERE nor Trimble could calculate the comparison route",
      502,
    );
  }

  const selectedRoute = env.routingProvider === "trimble"
    ? trimbleRoute ?? hereRoute
    : hereRoute ?? trimbleRoute;
  return {
    selectedProvider: selectedRoute?.provider,
    selectedRoute,
    providers: {
      HERE: hereRoute ? comparisonSummary(hereRoute) : null,
      Trimble: trimbleRoute ? comparisonSummary(trimbleRoute) : null,
    },
    difference: hereRoute && trimbleRoute ? {
      mileage: Number((trimbleRoute.distanceMiles - hereRoute.distanceMiles).toFixed(2)),
      etaMinutes: trimbleRoute.etaMinutes - hereRoute.etaMinutes,
      geometryPointCount: trimbleRoute.routeGeometry.length - hereRoute.routeGeometry.length,
    } : null,
    requestedTruckRestrictions: input.truck,
    providerErrors: {
      HERE: reason(hereResult),
      Trimble: reason(trimbleResult),
    },
  };
}
