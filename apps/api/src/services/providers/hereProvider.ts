import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { RoutingProviderError } from "./routeProvider.js";

/** Retained rejection boundary for legacy callers. HERE may supply data, never routes. */
export class HereRouteProvider implements RouteProvider {
  readonly name = "HERE" as const;
  async buildRoute(_input: RouteBuildInput): Promise<RouteBuildResult> {
    throw new RoutingProviderError("HERE", "HERE_ROUTING_DISABLED",
      "HERE route calculation is unavailable. Use the verified Trimble truck route.", 410);
  }
}
