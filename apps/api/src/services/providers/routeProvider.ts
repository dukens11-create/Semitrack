import type { RouteBuildInput, RouteBuildResult, RoutingProviderName } from "../../types.js";

export class RoutingProviderError extends Error {
  // Set only after the provider transport boundary has been entered.
  providerAttempted = false;
  readonly truckSafe = false;
  readonly navigationAllowed = false;
  readonly provider: RoutingProviderName;
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    provider: RoutingProviderName,
    code: string,
    message: string,
    httpStatus = 502,
    retryable = false,
  ) {
    super(message);
    this.name = "RoutingProviderError";
    this.provider = provider;
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export interface RouteProvider {
  readonly name: RoutingProviderName;
  buildRoute(input: RouteBuildInput): Promise<RouteBuildResult>;
}
