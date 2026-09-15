import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { RoutingProviderError } from "./routeProvider.js";

/** Retained compatibility boundary: Mapbox is display/geocoding only. */
export class MapboxRouteProvider implements RouteProvider {
  readonly name = "Mapbox" as const;
  async buildRoute(_input: RouteBuildInput): Promise<RouteBuildResult> {
    throw new RoutingProviderError("Mapbox", "MAPBOX_ROUTING_DISABLED",
      "Passenger-route previews are unavailable. Use the verified Trimble truck route.", 410);
  }
}
