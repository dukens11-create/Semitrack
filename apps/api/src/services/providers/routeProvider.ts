import type { RouteBuildInput, RouteBuildResult } from "../../types.js";

export interface RouteProvider {
  buildRoute(input: RouteBuildInput): Promise<RouteBuildResult>;
}
