import { restrictionDiagnostic } from "./restrictionDiagnostic.js";
import { optionalPreferenceWarnings } from '../routingCapabilities.js';
import { z } from "zod";
import { routingTruckSchema } from "../../modules/trucks/truck.schemas.js";
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
  if (!/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clockToSeconds(value: unknown): number {
  // Trimble clock strings are hours:minutes[:seconds]. Missing is unavailable, never zero.
  if (typeof value !== 'string' || !/^\d+:[0-5]\d(?::[0-5]\d)?$/.test(value.trim())) return NaN;
  const parts = value.trim().split(':').map(Number);
  const seconds = parts[0]! * 3600 + parts[1]! * 60 + (parts.length === 3 ? parts[2]! : 0);
  return Number.isSafeInteger(seconds) ? seconds : NaN;
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
  const goods: HazardousGood[] = input.truck.hazardousGoods!;
  return [...new Set(goods.map((good) => hazmatCode[good]))];
}

function trailerType(input: RouteBuildInput): number {
  const count = input.truck.trailerCount!;
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

  const checked = z.object({ origin: z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)}), destination: z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)}), viaStops: z.array(z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)})).max(20).optional(), truck: routingTruckSchema, routeMode: z.enum(['fastest','fuel_optimized','shortest']).optional(), alternatives: z.number().int().min(0).max(5).optional() }).safeParse(input);
  if (!checked.success) throw new RoutingProviderError('Trimble','TRIMBLE_REQUEST_INVALID','Truck routing inputs are incomplete or invalid.',422);
  const truck = checked.data.truck;
  const bodyType=truck.trailerType?.trim().toLowerCase();
  if (!bodyType || /caravan|rv/i.test(bodyType) || (bodyType==='no trailer') !== (truck.trailerCount===0)) throw new RoutingProviderError('Trimble','TRIMBLE_REQUEST_INVALID','Trailer type and count must describe the actual commercial vehicle.',422);
  // Optional preferences are disclosed as unsupported; mandatory truck restrictions below remain enforced.
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
  const trailerCount = truck.trailerCount;
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
  if (!report) return [];
  const shape = report.geometry;
  const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
  const line = z.array(position).min(2).max(200000);
  const parsed = z.discriminatedUnion('type', [z.object({type:z.literal('LineString'),coordinates:line}),z.object({type:z.literal('MultiLineString'),coordinates:z.array(line).min(1).max(1000)})]).safeParse(shape);
  if (!parsed.success) throw new RoutingProviderError('Trimble','TRIMBLE_ROUTE_GEOMETRY_INVALID','RoutePath contains invalid coordinates or shape.');
  const lines = parsed.data.type === 'LineString' ? [parsed.data.coordinates] : parsed.data.coordinates;
  for (let i=1; i<lines.length; i++) {
    const before=lines[i-1]!.at(-1)!; const after=lines[i]![0]!;
    if (before[0]!==after[0] || before[1]!==after[1]) throw new RoutingProviderError('Trimble','TRIMBLE_ROUTE_GEOMETRY_INVALID','RoutePath contains disconnected segments.');
  }
  return lines.flat();
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
  return {};
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

// MileageReport.ReportLines[].Stop.Coords is the ordered provider stop evidence.
// SemiTraX policy allows at most 50 m for a small curb/access-road snap, not a
// facility-wide relocation. This conservative cap is separate from the existing
// 250 m geometry matching ceiling; neither geometry nor a nearby different stop
// can replace explicit, ordered stop metadata.
export const TRIMBLE_STOP_SNAP_TOLERANCE_METERS = 50;
function coverageFailure(): never {
  throw new RoutingProviderError('Trimble','TRIMBLE_STOP_COVERAGE_UNPROVEN','The provider did not prove the complete requested stop plan.',422);
}
function checkedStop(value: any, expected: {lat: number; lng: number}) {
  if (!value || (value.Errors != null && (!Array.isArray(value.Errors) || value.Errors.length))) coverageFailure();
  const lat = finiteNumber(value.Coords?.Lat);
  const lng = finiteNumber(value.Coords?.Lon);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) coverageFailure();
  const actual = {lat, lng};
  const distance = distanceMeters(actual, expected);
  if (!Number.isFinite(distance) || distance > TRIMBLE_STOP_SNAP_TOLERANCE_METERS) coverageFailure();
  return actual;
}
function validatePathStops(geometry:number[][],points:{lat:number;lng:number}[]) {
  if(geometry.length<2)coverageFailure();
  let offset=0;
  for(let i=0;i<points.length;i++){
    let best=Infinity,next=offset;
    const from=i===0?0:i===points.length-1?geometry.length-1:offset;
    const end=i===0?1:geometry.length;
    for(let j=from;j<end;j++){
      const distance=distanceMeters(points[i]!,{lng:geometry[j]![0]!,lat:geometry[j]![1]!});
      if(distance<best){best=distance;next=j;}
    }
    if(!Number.isFinite(best)||best>MANEUVER_MATCH_MAX_METERS)coverageFailure();
    offset=next;
  }
}
function validateStopCoverage(directions:any,mileage:any,geometry:number[][],input:RouteBuildInput){
  const points=[input.origin,...(input.viaStops??[]),input.destination];
  const legs=directions?.ReportLegs,rows=mileage?.ReportLines;
  if(!Array.isArray(legs)||legs.length!==points.length-1||!Array.isArray(rows)||rows.length!==points.length)coverageFailure();
  checkedStop(directions.Origin,points[0]!);checkedStop(directions.Destination,points.at(-1)!);
  const validatedStops = points.map((point, index) => {
    const actual = checkedStop(rows[index]?.Stop, point);
    const expectedDistance = distanceMeters(actual, point);
    // Reject ambiguous/reordered evidence even when nearby stops fall inside the
    // snap radius. Identical requested coordinates remain legitimate repeat stops.
    if (points.some(other => (other.lat !== point.lat || other.lng !== point.lng)
      && distanceMeters(actual, other) <= expectedDistance)) coverageFailure();
    return actual;
  });
  legs.forEach((leg:any,index:number)=>{
    checkedStop(leg.Origin,points[index]!);checkedStop(leg.Dest,points[index+1]!);
    if(!Array.isArray(leg.ReportLines)||!leg.ReportLines.length)coverageFailure();
  });
  validatePathStops(geometry,points);
  return validatedStops;
}

function directionMarker(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^(?:origin|stop\s+\d+)\b/i.test(text);
}

function clockToleranceSeconds(value: unknown) {
  return typeof value === "string" && /^\d+:[0-5]\d$/.test(value.trim()) ? 59 : 1;
}

function sameMileageValue(directionValue: number, mileageValue: number, tolerance = 0.02) {
  return Number.isFinite(directionValue)
    && Number.isFinite(mileageValue)
    && Math.abs(directionValue - mileageValue) <= tolerance;
}

function sameClockValue(directionRaw: unknown, directionSeconds: number, mileageSeconds: number) {
  return Number.isFinite(directionSeconds)
    && Number.isFinite(mileageSeconds)
    && Math.abs(directionSeconds - mileageSeconds) <= clockToleranceSeconds(directionRaw);
}

function parseDirectionLegs(report: any, geometry: number[][], mileageReport: any) {
  const mileageLines = Array.isArray(mileageReport?.ReportLines) ? mileageReport.ReportLines : [];
  const reportLegs = Array.isArray(report?.ReportLegs) ? report.ReportLegs : [];
  const warnings: string[] = [];
  const legs: RouteLeg[] = [];
  let maneuverStep = 0;

  const providerWarning = (line: any, legIndex: number, lineIndex: number) => {
    const warning = typeof line?.Warn === "string" ? line.Warn.trim() : "";
    if (warning || (Array.isArray(line?.DetailedWarnings) && line.DetailedWarnings.some((w: any) => w?.Type !== 0))) {
      const failure = new RoutingProviderError(
        "Trimble",
        "TRIMBLE_RESTRICTION_WARNING",
        "The provider reported a route warning that requires review before this route can be used.",
        422,
      );
      failure.restrictionDiagnostic = restrictionDiagnostic(line, legIndex, lineIndex);
      throw failure;
    }
  };

  for (let legIndex = 0; legIndex < reportLegs.length; legIndex++) {
    const leg = reportLegs[legIndex];
    const lines = Array.isArray(leg?.ReportLines) ? leg.ReportLines : [];
    const mileageStart = mileageLines[legIndex] ?? {};
    const mileageEnd = mileageLines[legIndex + 1] ?? {};
    const mileageStartDistance = finiteNumber(mileageStart.TMiles);
    const mileageStartDuration = clockToSeconds(mileageStart.THours);
    const mileageEndDistance = finiteNumber(mileageEnd.TMiles);
    const mileageEndDuration = clockToSeconds(mileageEnd.THours);

    if (
      mileageStartDistance == null || mileageStartDistance < 0 ||
      !Number.isFinite(mileageStartDuration) ||
      mileageEndDistance == null || mileageEndDistance < mileageStartDistance ||
      !Number.isFinite(mileageEndDuration) || mileageEndDuration < mileageStartDuration
    ) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_DATA_REQUIRED",
        "The provider did not supply consistent cumulative mileage boundaries for this leg.",
      );
    }

    lines.forEach((line: any, lineIndex: number) => providerWarning(line, legIndex, lineIndex));

    // Trimble Directions values are cumulative across the trip. On later legs,
    // the provider repeats the intermediate stop as the first Directions row.
    // That explicit row is the only safe Directions baseline. Mileage can carry
    // seconds while Directions is minute-precision, so cross-report validation
    // allows only the precision gap, never a material counter mismatch.
    const baselineIndex = lines.findIndex((line: any, index: number) =>
      index <= 2 && directionMarker(line?.Direction)
      && finiteNumber(line?.Dist) != null
      && Number.isFinite(clockToSeconds(line?.Time)),
    );

    let startingDistance = mileageStartDistance;
    let startingDuration = mileageStartDuration;
    if (baselineIndex >= 0) {
      const baseline = lines[baselineIndex];
      const directionDistance = finiteNumber(baseline?.Dist)!;
      const directionDuration = clockToSeconds(baseline?.Time);
      if (
        !sameMileageValue(directionDistance, mileageStartDistance) ||
        !sameClockValue(baseline?.Time, directionDuration, mileageStartDuration)
      ) {
        throw new RoutingProviderError(
          "Trimble",
          "TRIMBLE_MANEUVER_DATA_REQUIRED",
          "Directions and Mileage reports disagree at an intermediate-stop boundary.",
        );
      }
      startingDistance = directionDistance;
      startingDuration = directionDuration;

      // A later-leg baseline is also the provider's explicit intermediate-arrival
      // marker. Preserve it in global maneuver order by attaching it to the
      // preceding leg, but never manufacture one when the marker is absent.
      if (legIndex > 0) {
        const instruction = String(baseline?.Direction ?? "").trim();
        const raw = baseline?.End ?? baseline?.Begin;
        const lat = finiteNumber(raw?.Lat ?? raw?.lat);
        const lng = finiteNumber(raw?.Lon ?? raw?.lon ?? raw?.Lng ?? raw?.lng);
        if (!instruction || lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw new RoutingProviderError(
            "Trimble",
            "TRIMBLE_MANEUVER_DATA_REQUIRED",
            "The provider did not supply a usable intermediate-stop arrival marker.",
          );
        }
        const previous = legs.at(-1);
        if (!previous) {
          throw new RoutingProviderError(
            "Trimble",
            "TRIMBLE_MANEUVER_DATA_REQUIRED",
            "Intermediate-stop ordering could not be established.",
          );
        }
        const existingArrival = previous.maneuvers.at(-1);
        if (!(
          existingArrival?.action === "arrive" &&
          existingArrival.coordinate &&
          distanceMeters(existingArrival.coordinate, { lat, lng }) <= 1
        )) {
          previous.maneuvers.push({
            step: ++maneuverStep,
            instruction,
            distanceMiles: 0,
            durationSeconds: 0,
            action: "arrive",
            direction: "straight",
            coordinate: { lat, lng },
          });
        }
      }
    } else if (legIndex > 0) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_DATA_REQUIRED",
        "The provider did not supply the intermediate-stop marker required to align multi-stop directions safely.",
      );
    }

    const maneuvers: RouteManeuver[] = [];
    const contentLines = baselineIndex >= 0
      ? lines.filter((_: any, index: number) => index !== baselineIndex)
      : lines;
    const straightLeg = !contentLines.some((line: any) => line?.TurnInstruction
      || /^destination\b/i.test(String(line?.Direction ?? "").trim())
      || /^stop\s+\d+\b/i.test(String(line?.Direction ?? "").trim()));
    let lastDistance = startingDistance;
    let lastDuration = startingDuration;
    let lastDirectionTimeRaw: unknown;

    for (let index = 0; index < lines.length; index++) {
      if (index === baselineIndex) continue;
      const line = lines[index];
      const instruction = typeof line?.Direction === "string" ? line.Direction.trim() : "";
      const isArrival = /^(?:destination|stop\s+\d+)\b/i.test(instruction);
      if (!straightLeg && !line?.TurnInstruction && !isArrival) continue;
      if (straightLeg && line?.Dist == null && line?.Time == null) continue;

      let cumulativeDistance = finiteNumber(line?.Dist);
      let cumulativeDuration = clockToSeconds(line?.Time);
      let timeRaw: unknown = line?.Time;
      if (!straightLeg && cumulativeDistance == null && !isArrival) {
        for (let next = index + 1; next < lines.length; next++) {
          if (next === baselineIndex) continue;
          const nextInstruction = String(lines[next]?.Direction ?? "").trim();
          if (lines[next]?.TurnInstruction || /^(?:destination|stop\s+\d+)\b/i.test(nextInstruction)) break;
          cumulativeDistance = finiteNumber(lines[next]?.Dist);
          cumulativeDuration = clockToSeconds(lines[next]?.Time);
          timeRaw = lines[next]?.Time;
          if (cumulativeDistance != null && Number.isFinite(cumulativeDuration)) break;
        }
      }

      if (
        !instruction ||
        cumulativeDistance == null ||
        cumulativeDistance < lastDistance ||
        !Number.isFinite(cumulativeDuration) ||
        cumulativeDuration < lastDuration
      ) {
        throw new RoutingProviderError(
          "Trimble",
          "TRIMBLE_MANEUVER_DATA_REQUIRED",
          "Maneuver distance, time or instruction is missing or inconsistent.",
        );
      }

      const action = maneuverAction(line?.TurnInstruction, instruction);
      const candidates = straightLeg
        ? [line?.Begin, line?.End]
        : [isArrival ? line?.End ?? line?.Begin : line?.Begin ?? line?.End];
      const providerCoordinate = candidates
        .map(raw => ({
          lat: finiteNumber(raw?.Lat ?? raw?.lat),
          lng: finiteNumber(raw?.Lon ?? raw?.lon ?? raw?.Lng ?? raw?.lng),
        }))
        .find((point): point is { lat: number; lng: number } =>
          point.lat != null && point.lng != null &&
          Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180);

      maneuvers.push({
        step: ++maneuverStep,
        instruction,
        distanceMiles: Number((cumulativeDistance - lastDistance).toFixed(3)),
        durationSeconds: cumulativeDuration - lastDuration,
        action: action.action ?? (isArrival ? "arrive" : straightLeg ? "continue" : undefined),
        direction: action.direction ?? (isArrival || straightLeg ? "straight" : undefined),
        roadName: roadNameFrom(instruction),
        nextRoadName: roadNameFrom(instruction),
        exitNumber: exitNumberFrom(instruction, line?.InterCh),
        ...(providerCoordinate ? { coordinate: providerCoordinate } : {}),
      });
      lastDistance = cumulativeDistance;
      lastDuration = cumulativeDuration;

      // Remember the precision of the last Directions counter so the end-of-leg
      // Mileage comparison uses only the provider's documented rounding gap.
      if (timeRaw !== undefined) lastDirectionTimeRaw = timeRaw;
    }

    const legMiles = finiteNumber(mileageEnd.LMiles);
    const legHours = clockToSeconds(mileageEnd.LHours);
    if (!maneuvers.length || legMiles == null || legMiles < 0 || !Number.isFinite(legHours)) {
      throw new RoutingProviderError("Trimble", "TRIMBLE_INCOMPLETE_ROUTE", "Route leg data is incomplete.");
    }

    const expectedLegMiles = mileageEndDistance - mileageStartDistance;
    const expectedLegSeconds = mileageEndDuration - mileageStartDuration;
    if (
      !sameMileageValue(expectedLegMiles, legMiles) ||
      Math.abs(expectedLegSeconds - legHours) > 1
    ) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_DATA_REQUIRED",
        "Mileage leg totals conflict with cumulative trip totals.",
      );
    }

    if (
      !sameMileageValue(lastDistance, mileageEndDistance) ||
      !sameClockValue(lastDirectionTimeRaw, lastDuration, mileageEndDuration)
    ) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_DATA_REQUIRED",
        "Directions and Mileage reports disagree at the end of a route leg.",
      );
    }

    legs.push({
      distanceMiles: legMiles,
      durationSeconds: legHours,
      geometry: legIndex === 0 ? geometry : [],
      maneuvers,
    });
  }

  return { legs, warnings };
}

const MANEUVER_MATCH_MAX_METERS = 250;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Maps authoritative Trimble maneuver coordinates monotonically to RoutePath. */
export function matchTrimbleManeuversToGeometry(maneuvers: RouteManeuver[], geometry: number[][]) {
  if (geometry.length < 2) throw new Error("Route geometry must contain at least two points");
  let minimumOffset = 0;
  return maneuvers.map((maneuver, index) => {
    const coordinate = maneuver.coordinate;
    if (!coordinate || !Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lng) || Math.abs(coordinate.lat) > 90 || Math.abs(coordinate.lng) > 180) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_COORDINATE_REQUIRED",
        `Trimble maneuver ${index + 1} has no coordinate and cannot be placed safely on the route geometry`,
        502,
      );
    }

    let bestOffset = minimumOffset;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let offset = minimumOffset; offset < geometry.length; offset++) {
      const point = geometry[offset];
      if (!Array.isArray(point) || point.length < 2) continue;
      const candidate = { lat: Number(point[1]), lng: Number(point[0]) };
      if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue;
      const distance = distanceMeters(coordinate, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = offset;
      }
    }
    if (!Number.isFinite(bestDistance) || bestDistance > MANEUVER_MATCH_MAX_METERS) {
      throw new RoutingProviderError(
        "Trimble",
        "TRIMBLE_MANEUVER_GEOMETRY_MISMATCH",
        `Trimble maneuver ${index + 1} is ${Math.round(bestDistance)} meters from the RoutePath geometry`,
        502,
      );
    }
    minimumOffset = bestOffset;
    return {
      ...maneuver,
      offset: bestOffset,
      geometryMatchDistanceMeters: Number(bestDistance.toFixed(1)),
    };
  });
}

function parseAlternateRoutes(reports: any[], input: RouteBuildInput): RouteOption[] {
  const alternateReport = reportOfType(reports, "AlternateRoutesReport");
  const alternatives = Array.isArray(alternateReport?.AlternateRoutes) ? alternateReport.AlternateRoutes : [];
  return alternatives.flatMap((alternate: any, index: number) => {
    const routeReports = reportsFrom(alternate?.RouteReports);
    const path = reportOfType(routeReports, "RoutePathReport");
    const geometry = flattenRoutePathGeometry(path);
    const distance = finiteNumber(path?.TDistance);
    const durationMinutes = finiteNumber(path?.TMinutes);
    if (geometry.length < 2 || distance == null || distance < 0 || durationMinutes == null || durationMinutes <= 0) throw new RoutingProviderError("Trimble", "TRIMBLE_ALTERNATIVE_INVALID", "Alternative route data is invalid.");
    validatePathStops(geometry,[input.origin,...(input.viaStops??[]),input.destination]);
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

  const routeIds=[directions.RouteID,mileage.RouteID,routePath?.RouteID].filter(id=>id!=null).map(String);
  if (new Set(routeIds).size>1) throw new RoutingProviderError('Trimble','TRIMBLE_ROUTE_ID_MISMATCH','Route reports refer to different routes.');
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
  if (distanceMiles == null || distanceMiles < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RoutingProviderError(
      "Trimble",
      "TRIMBLE_INCOMPLETE_ROUTE",
      "Trimble returned an incomplete truck-route summary",
    );
  }

  const validatedStops=validateStopCoverage(directions,mileage,routeGeometry,input);
  const { legs, warnings } = parseDirectionLegs(directions, routeGeometry, mileage);
  if (!legs.length) throw new RoutingProviderError("Trimble", "TRIMBLE_INCOMPLETE_ROUTE", "No route legs were returned.");
  const matchedManeuvers = matchTrimbleManeuversToGeometry(
    legs.flatMap((leg) => leg.maneuvers),
    routeGeometry,
  );
  let matchedIndex = 0;
  const matchedLegs = legs.map((leg) => ({
    ...leg,
    maneuvers: leg.maneuvers.map(() => matchedManeuvers[matchedIndex++]!),
  }));
  const alerts = [...new Set(warnings)];
  alerts.push(...optionalPreferenceWarnings(input.truck).map(warning => warning.message));
  if ((input.alternatives ?? 0) > 0 && !(config.routePathEnabled && config.alternateRoutesEnabled)) {
    alerts.push("Trimble alternatives were not requested because RoutePath and Alternate Routes entitlements are disabled.");
  }

  const routeId = String(directions.RouteID ?? mileage.RouteID ?? "trimble-primary");
  return {
    provider: "Trimble",
    truckSafe: true,
    navigationAllowed: config.routePathEnabled,
    trafficAware: mileage.TrafficDataUsed === true,
    calculatedAt: new Date().toISOString(),
    selectedRouteId: routeId,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    etaMinutes: Math.ceil(durationSeconds / 60),
    durationSeconds,
    routeGeometry,
    legs: matchedLegs,
    turnByTurn: matchedManeuvers,
    alternatives: parseAlternateRoutes(reports,input),
    validatedStops,
    preferenceWarnings: optionalPreferenceWarnings(input.truck),
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
    let timeoutReject!: (error: Error) => void;
    const deadline=new Promise<never>((_resolve,reject)=>{timeoutReject=reject;});
    const requestTimeout=setTimeout(()=>{requestController.abort();timeoutReject(new Error('Provider deadline exceeded'));},this.config.requestTimeoutMs);
    // Local configuration and request validation above are not provider attempts.
    try {
      let response: Response;
      let responseBody: string;
      try {
        response = await Promise.race([this.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: this.config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
          signal: requestController.signal,
          redirect: "error",
        }),deadline]);
        responseBody = await Promise.race([response.text(),deadline]);
        if (responseBody.length > 20_000_000) throw new RoutingProviderError("Trimble", "TRIMBLE_RESPONSE_TOO_LARGE", "Route response exceeds the supported size.");
      } catch (error) {
        if (error instanceof RoutingProviderError) throw error;
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
        const body = responseBody.slice(0, 2_000);
        throw trimbleFailure(response.status, body);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseBody);
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
    } catch (error) {
      const failure = error instanceof RoutingProviderError ? error : new RoutingProviderError(
        "Trimble", "TRIMBLE_INVALID_RESPONSE", "Trimble returned unusable route evidence.",
      );
      failure.providerAttempted = true;
      throw failure;
    }
  }
}
