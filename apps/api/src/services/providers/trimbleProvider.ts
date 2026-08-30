import { env } from "../../config/env.js";
import type {
  HazardousGood,
  RouteBuildInput,
  RouteBuildResult,
  RouteLeg,
  RouteManeuver,
  RouteOption,
} from "../../types.js";
import { RoutingProviderError, type RouteProvider } from "./routeProvider.js";

const REPORT_TYPE_NAMESPACE = "http://pcmiler.alk.com/APIs/v1.0";

export type TrimbleProviderConfig = {
  apiKey: string;
  baseUrl: string;
  dataVersion: string;
  profileName: string;
  geoTunnelIntervalMiles: number;
  requestTimeoutMs: number;
  routePathEnabled: boolean;
  alternateRoutesEnabled: boolean;
};

type FetchLike = typeof fetch;

const defaultConfig = (): TrimbleProviderConfig => ({
  apiKey: env.trimbleApiKey,
  baseUrl: env.trimbleBaseUrl,
  dataVersion: env.trimbleDataVersion,
  profileName: env.trimbleProfileName,
  geoTunnelIntervalMiles: env.trimbleGeoTunnelIntervalMiles,
  requestTimeoutMs: env.trimbleRequestTimeoutMs,
  routePathEnabled: env.trimbleRoutePathEnabled,
  alternateRoutesEnabled: env.trimbleAlternateRoutesEnabled,
});

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clockToSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return 0;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return Math.max(0, parts[0]! * 3600 + parts[1]! * 60 + parts[2]!);
  if (parts.length === 2) return Math.max(0, parts[0]! * 3600 + parts[1]! * 60);
  return Math.max(0, parts[0]! * 3600);
}

function assertRange(label: string, value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_TRUCK_PROFILE_OUT_OF_RANGE",
      `${label} must be between ${minimum} and ${maximum} for Trimble truck routing`,
      422,
    );
  }
}

const hazmatCode: Record<HazardousGood, number> = {
  explosive: 3,
  gas: 1,
  flammable: 4,
  combustible: 4,
  organic: 1,
  poison: 1,
  radioactive: 6,
  corrosive: 2,
  poisonousInhalation: 5,
  harmfulToWater: 7,
  other: 1,
};

function trimbleHazmatTypes(input: RouteBuildInput): number[] {
  if (!input.truck.hazmatEnabled) return [];
  const goods: HazardousGood[] = input.truck.hazardousGoods?.length ? input.truck.hazardousGoods : ["other"];
  return [...new Set(goods.map((good) => hazmatCode[good]))];
}

function trailerType(input: RouteBuildInput): number {
  const count = input.truck.trailerCount ?? 1;
  if (count <= 0) return 1;
  const configured = input.truck.trailerType?.trim().toLowerCase() ?? "";
  if (configured.includes("caravan") || configured.includes("rv")) return 2;
  return 3;
}

function trimbleRoutingType(input: RouteBuildInput): number {
  // Trimble documents Fastest as intended for autos/vans, not commercial
  // trucks. Practical remains the safe mapping for both fastest and
  // fuel-optimized UI choices.
  return input.routeMode === "shortest" ? 1 : 0;
}

export function buildTrimbleRouteRequest(input: RouteBuildInput, config: TrimbleProviderConfig) {
  if (input.avoidSegments?.length) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_PROVIDER_SEGMENT_IDS_REQUIRED",
      "The selected avoidance contains HERE segment IDs and cannot be sent to Trimble. Rebuild the avoidance with provider-neutral waypoints.",
      422,
    );
  }

  const truck = input.truck;
  const heightInches = truck.heightFt * 12;
  const widthInches = truck.widthFt * 12;
  const lengthInches = truck.lengthFt * 12;
  assertRange("Truck height (feet)", truck.heightFt, 5, 15);
  assertRange("Truck width (inches)", widthInches, 60, 102);
  assertRange("Truck/trailer length (feet)", truck.lengthFt, 8, 70);
  assertRange("Gross weight (pounds)", truck.weightLbs, 1_500, 156_470);
  assertRange("Axle count", truck.axleCount, 2, 14);
  if (truck.weightPerAxleLbs != null) {
    assertRange("Maximum weight per axle group (pounds)", truck.weightPerAxleLbs, 800, 45_000);
  }
  const trailerCount = truck.trailerCount ?? 1;
  if (!Number.isInteger(trailerCount) || trailerCount < 0) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_TRUCK_PROFILE_OUT_OF_RANGE",
      "Trailer count must be a non-negative whole number",
      422,
    );
  }

  const stops = [input.origin, ...(input.viaStops ?? []), input.destination].map((stop, index, all) => ({
    Coords: { Lat: stop.lat, Lon: stop.lng },
    Region: 4,
    Label: index === 0 ? "Origin" : index === all.length - 1 ? "Destination" : `Stop ${index}`,
    ID: index === 0 ? "Origin" : index === all.length - 1 ? "Destination" : `Stop-${index}`,
    IsViaPoint: false,
  }));

  const reportTypes: Array<Record<string, unknown>> = [
    {
      __type: `DirectionsReportType:${REPORT_TYPE_NAMESPACE}`,
      CondenseDirections: false,
    },
    {
      __type: `MileageReportType:${REPORT_TYPE_NAMESPACE}`,
      TimeInSeconds: true,
    },
    {
      __type: `GeoTunnelReportType:${REPORT_TYPE_NAMESPACE}`,
      CiteInterval: Math.max(0.1, config.geoTunnelIntervalMiles),
    },
  ];
  if (config.routePathEnabled) {
    reportTypes.push({
      __type: `RoutePathReportType:${REPORT_TYPE_NAMESPACE}`,
      IncludeDetails: true,
    });
  }

  const route: Record<string, unknown> = {
    RouteId: `semitrax-${Date.now()}`,
    Stops: stops,
    Options: {
      ...(config.profileName.trim() ? { ProfileName: config.profileName.trim() } : {}),
      VehicleType: 0,
      RoutingType: trimbleRoutingType(input),
      HighwayOnly: false,
      DistanceUnits: 0,
      OverrideRestrict: false,
      TollRoads: truck.avoidTolls ? 2 : 3,
      FerryDiscourage: truck.avoidFerries === true,
      HazMatTypes: trimbleHazmatTypes(input),
      TrailerCfg: {
        TypeOfTrailer: trailerType(input),
        Count: trailerCount,
      },
      TruckCfg: {
        Units: 0,
        Height: String(Number(heightInches.toFixed(2))),
        Width: String(Number(widthInches.toFixed(2))),
        Length: String(Number(lengthInches.toFixed(2))),
        Weight: String(Math.round(truck.weightLbs)),
        Axles: truck.axleCount,
        ...(truck.weightPerAxleLbs == null
          ? {}
          : { MaxWeightPerAxleGroup: Number(truck.weightPerAxleLbs.toFixed(2)) }),
        LCV: trailerCount > 1,
      },
    },
    ReportingOptions: {
      UseTraffic: true,
      IncludeVehicleRestrictedCleanupPoints: true,
    },
    ReportTypes: reportTypes,
  };

  if (config.routePathEnabled && config.alternateRoutesEnabled && (input.alternatives ?? 0) > 0) {
    route.AlternateRouteOptions = {
      Enabled: true,
      Type: 0,
      WaypointConfig: {
        IncludeBaseWaypoints: true,
        Waypoints: [],
      },
      MaxAlternates: Math.min(Math.max(input.alternatives ?? 0, 1), 3),
    };
  }

  return { ReportRoutes: [route] };
}

function reportsFrom(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload.flatMap(reportsFrom);
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  const own = typeof value.__type === "string" ? [value] : [];
  const nested = [value.Reports, value.RouteReports, value.ReportResults]
    .filter((item) => item !== undefined)
    .flatMap(reportsFrom);
  return [...own, ...nested];
}

function reportOfType(reports: any[], type: string) {
  return reports.find((report) => String(report?.__type ?? "").toLowerCase().includes(type.toLowerCase()));
}

function coordinate(value: any): number[] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const lng = finiteNumber(value[0]);
    const lat = finiteNumber(value[1]);
    return lng != null && lat != null ? [lng, lat] : null;
  }
  const coords = value?.Coords ?? value;
  const lat = finiteNumber(coords?.Lat ?? coords?.lat ?? coords?.Latitude ?? coords?.latitude);
  const lng = finiteNumber(coords?.Lon ?? coords?.lon ?? coords?.Lng ?? coords?.lng ?? coords?.Longitude ?? coords?.longitude);
  return lat != null && lng != null ? [lng, lat] : null;
}

function flattenRoutePathGeometry(report: any): number[][] {
  const coordinates = report?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  const points: number[][] = [];
  const visit = (value: unknown) => {
    const point = coordinate(value);
    if (point) {
      points.push(point);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  return points;
}

function longestCoordinateSequence(value: unknown): number[][] {
  let longest: number[][] = [];
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      const sequence = candidate.map(coordinate).filter((point): point is number[] => point != null);
      if (sequence.length > longest.length) longest = sequence;
      candidate.forEach(visit);
      return;
    }
    Object.values(candidate as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return longest;
}

function maneuverAction(turnInstruction: unknown, instruction: string) {
  const value = `${String(turnInstruction ?? "")} ${instruction}`.toLowerCase();
  if (value.includes("destination")) return { action: "arrive", direction: "straight" };
  if (value.includes("uturn") || value.includes("u-turn")) return { action: "turn", direction: "uturn" };
  if (value.includes("bearright")) return { action: "turn", direction: "slightRight" };
  if (value.includes("bearleft")) return { action: "turn", direction: "slightLeft" };
  if (value.includes("right")) return { action: "turn", direction: "right" };
  if (value.includes("left")) return { action: "turn", direction: "left" };
  if (value.includes("exit")) return { action: "exit", direction: "straight" };
  return { action: "continue", direction: "straight" };
}

function roadNameFrom(instruction: string): string | undefined {
  const match = instruction.match(/\b(?:on|onto|toward|towards|along|stay on|take)\s+(.+?)(?:\s+as\s+it|\s+for\s+|\s+\(|$)/i);
  return match?.[1]?.trim() || undefined;
}

function exitNumberFrom(instruction: string, interchange: unknown): string | undefined {
  const interchangeValue = typeof interchange === "string" ? interchange.trim() : "";
  if (interchangeValue) return interchangeValue;
  return instruction.match(/\bexit\s+([A-Z0-9-]+)/i)?.[1];
}

function parseDirectionLegs(report: any, geometry: number[][], mileageReport: any) {
  const mileageLines = Array.isArray(mileageReport?.ReportLines) ? mileageReport.ReportLines : [];
  const reportLegs = Array.isArray(report?.ReportLegs) ? report.ReportLegs : [];
  const warnings: string[] = [];
  let maneuverStep = 0;

  const legs: RouteLeg[] = reportLegs.map((leg: any, legIndex: number) => {
    const lines = Array.isArray(leg?.ReportLines) ? leg.ReportLines : [];
    const maneuvers: RouteManeuver[] = [];
    let lastDistance = legIndex === 0 ? 0 : finiteNumber(mileageLines[legIndex - 1]?.TMiles) ?? 0;
    let lastDuration = legIndex === 0 ? 0 : clockToSeconds(mileageLines[legIndex - 1]?.THours);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const warning = typeof line?.Warn === "string" ? line.Warn.trim() : "";
      if (warning) warnings.push(warning);
      const instruction = typeof line?.Direction === "string" ? line.Direction.trim() : "";
      const isArrival = /^destination\b/i.test(instruction);
      if (!line?.TurnInstruction && !isArrival) continue;

      let cumulativeDistance = finiteNumber(line?.Dist);
      let cumulativeDuration = line?.Time == null ? 0 : clockToSeconds(line.Time);
      if (cumulativeDistance == null && !isArrival) {
        for (let next = index + 1; next < lines.length; next++) {
          cumulativeDistance = finiteNumber(lines[next]?.Dist);
          cumulativeDuration = clockToSeconds(lines[next]?.Time);
          if (cumulativeDistance != null) break;
        }
      }
      const action = maneuverAction(line?.TurnInstruction, instruction);
      maneuvers.push({
        step: ++maneuverStep,
        instruction: instruction || (isArrival ? "Arrive at destination" : "Continue"),
        distanceMiles: cumulativeDistance == null ? 0 : Number(Math.max(0, cumulativeDistance - lastDistance).toFixed(3)),
        durationSeconds: Math.max(0, cumulativeDuration - lastDuration),
        action: action.action,
        direction: action.direction,
        roadName: roadNameFrom(instruction),
        nextRoadName: roadNameFrom(instruction),
        exitNumber: exitNumberFrom(instruction, line?.InterCh),
      });
      if (cumulativeDistance != null) lastDistance = cumulativeDistance;
      if (cumulativeDuration > 0) lastDuration = cumulativeDuration;
    }

    const mileage = mileageLines[legIndex] ?? {};
    return {
      distanceMiles: finiteNumber(mileage.LMiles) ?? Number(Math.max(0, lastDistance).toFixed(3)),
      durationSeconds: clockToSeconds(mileage.LHours) || Math.max(0, lastDuration),
      geometry: legIndex === 0 ? geometry : [],
      maneuvers,
    };
  });

  return { legs, warnings };
}

function parseAlternateRoutes(reports: any[]): RouteOption[] {
  const alternateReport = reportOfType(reports, "AlternateRoutesReport");
  const alternatives = Array.isArray(alternateReport?.AlternateRoutes) ? alternateReport.AlternateRoutes : [];
  return alternatives.flatMap((alternate: any, index: number) => {
    const routeReports = reportsFrom(alternate?.RouteReports);
    const path = reportOfType(routeReports, "RoutePathReport");
    const geometry = flattenRoutePathGeometry(path);
    const distance = finiteNumber(path?.TDistance);
    const durationMinutes = finiteNumber(path?.TMinutes);
    if (!geometry.length || distance == null || durationMinutes == null) return [];
    const durationSeconds = Math.round(durationMinutes * 60);
    return [{
      id: String(path?.RouteID ?? `trimble-alternative-${index + 1}`),
      distanceMiles: Number(distance.toFixed(2)),
      etaMinutes: Math.ceil(durationSeconds / 60),
      durationSeconds,
      routeGeometry: geometry,
      legs: [],
      turnByTurn: [],
      notices: [{
        code: "TRIMBLE_ALTERNATE_PREVIEW",
        title: "Recalculate this alternative before starting guidance",
        severity: "info",
      }],
    } satisfies RouteOption];
  });
}

export function parseTrimbleRouteResponse(payload: unknown, input: RouteBuildInput, config: TrimbleProviderConfig): RouteBuildResult {
  const reports = reportsFrom(payload);
  const directions = reportOfType(reports, "DirectionsReport");
  const mileage = reportOfType(reports, "MileageReport");
  const routePath = reportOfType(reports, "RoutePathReport");
  const geoTunnel = reportOfType(reports, "GeoTunnelReport");
  if (!directions || !mileage) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_INCOMPLETE_ROUTE",
      "Trimble did not return the required truck mileage and directions reports",
    );
  }

  const mileageLines = Array.isArray(mileage.ReportLines) ? mileage.ReportLines : [];
  const finalMileage = mileageLines.at(-1) ?? {};
  const distanceMiles = finiteNumber(finalMileage.TMiles);
  const durationSeconds = clockToSeconds(finalMileage.THours);
  const routePathGeometry = flattenRoutePathGeometry(routePath);
  const geoTunnelGeometry = longestCoordinateSequence(geoTunnel);
  if (config.routePathEnabled && routePathGeometry.length < 2) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_ROUTE_PATH_REQUIRED",
      "Trimble did not return navigation-quality RoutePath geometry. Enable the Trimble Maps/RoutePath entitlement; sparse GeoTunnel points are not safe to draw as a turn-by-turn road path.",
      503,
    );
  }
  const routeGeometry = config.routePathEnabled ? routePathGeometry : geoTunnelGeometry;
  if (routeGeometry.length < 2) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_ROUTE_GEOMETRY_UNAVAILABLE",
      "Trimble returned no usable route geometry. Verify RoutePath or GeoTunnel access for this API key.",
    );
  }
  if (distanceMiles == null || durationSeconds <= 0) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_INCOMPLETE_ROUTE",
      "Trimble returned an incomplete truck-route summary",
    );
  }

  const { legs, warnings } = parseDirectionLegs(directions, routeGeometry, mileage);
  const alerts = [...new Set(warnings)];
  if (input.truck.avoidResidential) alerts.push("Trimble does not expose a direct avoid-residential Route Reports option; truck restrictions remain enforced.");
  if (input.truck.avoidHighways) alerts.push("Trimble does not expose a direct avoid-highways Route Reports option; Practical truck routing was used.");
  if (input.truck.avoidDirtRoads) alerts.push("Trimble Route Reports does not expose a verified dirt-road avoidance field; no unsupported option was sent.");
  if ((input.alternatives ?? 0) > 0 && !(config.routePathEnabled && config.alternateRoutesEnabled)) {
    alerts.push("Trimble alternatives were not requested because RoutePath and Alternate Routes entitlements are disabled.");
  }

  const routeId = String(directions.RouteID ?? mileage.RouteID ?? "trimble-primary");
  return {
    provider: "Trimble",
    truckSafe: true,
    navigationAllowed: true,
    trafficAware: mileage.TrafficDataUsed === true,
    calculatedAt: new Date().toISOString(),
    selectedRouteId: routeId,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    etaMinutes: Math.ceil(durationSeconds / 60),
    durationSeconds,
    routeGeometry,
    legs,
    turnByTurn: legs.flatMap((leg) => leg.maneuvers),
    alternatives: parseAlternateRoutes(reports),
    alerts,
  };
}

function trimbleFailure(status: number, body: string) {
  const normalized = body.toUpperCase();
  if (status === 401 || status === 403 || normalized.includes("INVLD_LOGIN") || normalized.includes("LOGIN_DISABLED")) {
    return new RoutingProviderError(
      "Trimble",
      "TRIMBLE_AUTHORIZATION_FAILED",
      "Trimble rejected the API credential. The trial may be expired or missing Route Reports access.",
      502,
    );
  }
  if (status === 429 || normalized.includes("TRIP_LIMIT_EXCEEDED") || normalized.includes("QUOTA")) {
    return new RoutingProviderError(
      "Trimble",
      "TRIMBLE_QUOTA_EXCEEDED",
      "Trimble route quota is currently exhausted. Try again later or review the trial limits.",
      503,
      true,
    );
  }
  if (status === 400 || normalized.includes("NO ROUTE") || normalized.includes("ROUTE_NOT_FOUND")) {
    return new RoutingProviderError(
      "Trimble",
      "TRIMBLE_ROUTE_UNAVAILABLE",
      "Trimble could not calculate a legal commercial-truck route for these stops and vehicle restrictions.",
      422,
    );
  }
  return new RoutingProviderError(
    "Trimble",
    "TRIMBLE_HTTP_ERROR",
    `Trimble truck routing failed with HTTP ${status}`,
    status >= 500 ? 503 : 502,
    status >= 500,
  );
}

export class TrimbleRouteProvider implements RouteProvider {
  readonly name = "Trimble" as const;
  private readonly config: TrimbleProviderConfig;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: TrimbleProviderConfig = defaultConfig(),
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async buildRoute(input: RouteBuildInput): Promise<RouteBuildResult> {
    if (!this.config.apiKey) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_API_KEY_MISSING",
        "TRIMBLE_API_KEY is not configured",
        503,
      );
    }
    if (!Number.isFinite(this.config.geoTunnelIntervalMiles) || this.config.geoTunnelIntervalMiles < 0.1) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_CONFIGURATION_INVALID",
        "TRIMBLE_GEOTUNNEL_INTERVAL_MILES must be at least 0.1",
        503,
      );
    }
    if (
      !Number.isFinite(this.config.requestTimeoutMs) ||
      this.config.requestTimeoutMs < 1_000 ||
      this.config.requestTimeoutMs > 60_000
    ) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_CONFIGURATION_INVALID",
        "TRIMBLE_REQUEST_TIMEOUT_MS must be between 1000 and 60000",
        503,
      );
    }

    const request = buildTrimbleRouteRequest(input, this.config);
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/route/routeReports?dataVersion=${encodeURIComponent(this.config.dataVersion)}`;
    const requestController = new AbortController();
    const requestTimeout = setTimeout(
      () => requestController.abort(),
      this.config.requestTimeoutMs,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: this.config.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: requestController.signal,
      });
    } catch {
      const timedOut = requestController.signal.aborted;
      throw new RoutingProviderError(
        "Trimble",
        timedOut ? "TRIMBLE_REQUEST_TIMEOUT" : "TRIMBLE_NETWORK_ERROR",
        timedOut
          ? "Trimble truck routing took too long to respond"
          : "Trimble truck routing is temporarily unreachable",
        503,
        true,
      );
    } finally {
      clearTimeout(requestTimeout);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      throw trimbleFailure(response.status, body);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_INVALID_RESPONSE",
        "Trimble returned a non-JSON route response",
      );
    }
    const serialized = JSON.stringify(payload);
    if (/INVLD_LOGIN|LOGIN_DISABLED|TRIP_LIMIT_EXCEEDED/i.test(serialized)) {
      throw trimbleFailure(/TRIP_LIMIT_EXCEEDED/i.test(serialized) ? 429 : 401, serialized.slice(0, 2_000));
    }
    return parseTrimbleRouteResponse(payload, input, this.config);
  }
}
