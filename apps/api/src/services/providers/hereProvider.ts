import { env } from "../../config/env.js";
import type { RouteBuildInput, RouteBuildResult, RouteLeg, RouteManeuver, RouteOption } from "../../types.js";
import { hereDepartureTime } from "./hereTime.js";
import { feetToHereCentimeters, poundsToHereKilograms } from "./hereVehicleUnits.js";
import type { RouteProvider } from "./routeProvider.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(2));
}

function decodeHereFlexPolyline(encoded: string): number[][] {
  if (!encoded) return [];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const inverse = new Array<number>(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) inverse[alphabet.charCodeAt(i)] = i;
  let index = 0;
  const decodeUnsigned = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) throw new Error("Invalid HERE flexible polyline");
      const code = encoded.charCodeAt(index++);
      const value = code < 128 ? (inverse[code] ?? -1) : -1;
      if (value < 0) throw new Error("Invalid HERE flexible polyline character");
      result |= (value & 0x1f) << shift;
      if ((value & 0x20) === 0) return result;
      shift += 5;
    }
  };
  const decodeSigned = () => {
    const value = decodeUnsigned();
    return (value & 1) ? ~(value >> 1) : value >> 1;
  };
  decodeUnsigned();
  const header = decodeUnsigned();
  const precision = header & 0x0f;
  const thirdDimension = (header >> 4) & 0x07;
  const factor = 10 ** precision;
  let latitude = 0;
  let longitude = 0;
  const points: number[][] = [];
  while (index < encoded.length) {
    latitude += decodeSigned();
    longitude += decodeSigned();
    if (thirdDimension !== 0) decodeSigned();
    points.push([longitude / factor, latitude / factor]);
  }
  return points;
}

function actionToManeuver(action: any, index: number): RouteManeuver {
  const lanes = Array.isArray(action.lanes)
    ? action.lanes.map((lane: any) => ({
        directions: Array.isArray(lane.directions) ? lane.directions.map(String) : [],
        active: lane.active === true || lane.recommended === true,
      }))
    : undefined;
  return {
    step: index + 1,
    instruction: String(action.instruction ?? action.action ?? "Continue"),
    distanceMiles: metersToMiles(Number(action.length ?? 0)),
    durationSeconds: Number(action.duration ?? 0),
    action: action.action ? String(action.action) : undefined,
    direction: action.direction ? String(action.direction) : undefined,
    roadName: action.nextRoad?.name?.[0]?.value ?? action.currentRoad?.name?.[0]?.value,
    currentRoadName: action.currentRoad?.name?.[0]?.value,
    nextRoadName: action.nextRoad?.name?.[0]?.value,
    exitNumber: action.exitSign?.number ? String(action.exitSign.number) : undefined,
    offset: typeof action.offset === "number" ? action.offset : undefined,
    lanes: lanes?.length ? lanes : undefined,
  };
}

function parseRoute(route: any, routeIndex: number): RouteOption {
  const sections = Array.isArray(route.sections) ? route.sections : [];
  if (!sections.length) throw new Error("HERE route missing sections");
  let maneuverIndex = 0;
  const legs: RouteLeg[] = sections.map((section: any) => {
    const summary = section.summary ?? {};
    const actions = Array.isArray(section.actions) ? section.actions : [];
    const maneuvers = actions.map((action: any) => actionToManeuver(action, maneuverIndex++));
    return {
      distanceMiles: metersToMiles(Number(summary.length ?? 0)),
      durationSeconds: Number(summary.duration ?? 0),
      geometry: decodeHereFlexPolyline(String(section.polyline ?? "")),
      maneuvers,
    };
  });
  const rawNotices = [
    ...(Array.isArray(route.notices) ? route.notices : []),
    ...sections.flatMap((section: any) => Array.isArray(section.notices) ? section.notices : []),
  ];
  const noticeKeys = new Set<string>();
  const notices = rawNotices
    .map((notice: any) => ({
      code: String(notice.code ?? "unknown"),
      title: notice.title ? String(notice.title) : undefined,
      severity: notice.severity ? String(notice.severity) : undefined,
    }))
    .filter((notice) => {
      const key = `${notice.code}|${notice.title ?? ""}|${notice.severity ?? ""}`;
      if (noticeKeys.has(key)) return false;
      noticeKeys.add(key);
      return true;
    });
  const durationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  return {
    id: String(route.id ?? `here-route-${routeIndex}`),
    distanceMiles: Number(legs.reduce((sum, leg) => sum + leg.distanceMiles, 0).toFixed(2)),
    etaMinutes: Math.ceil(durationSeconds / 60),
    durationSeconds,
    routeGeometry: legs.flatMap((leg, index) => index === 0 ? leg.geometry : leg.geometry.slice(1)),
    legs,
    turnByTurn: legs.flatMap((leg) => leg.maneuvers),
    notices,
  };
}

export class HereRouteProvider implements RouteProvider {
  readonly name = "HERE" as const;

  async buildRoute(input: RouteBuildInput): Promise<RouteBuildResult> {
    if (!env.hereApiKey) throw new Error("HERE_API_KEY is not configured");
    const truck = input.truck;
    const params = new URLSearchParams({
      origin: `${input.origin.lat},${input.origin.lng}`,
      destination: `${input.destination.lat},${input.destination.lng}`,
      transportMode: "truck",
      routingMode: input.routeMode === "shortest" ? "short" : "fast",
      return: "summary,polyline,actions,instructions,travelSummary",
      // HERE Routing v8 expects an RFC 3339/ISO-8601 timestamp here. The
      // formerly accepted `now` alias is rejected by the current API.
      departureTime: hereDepartureTime(),
      apiKey: env.hereApiKey,
      "vehicle[grossWeight]": poundsToHereKilograms(truck.weightLbs),
      "vehicle[currentWeight]": poundsToHereKilograms(truck.currentWeightLbs ?? truck.weightLbs),
      "vehicle[height]": feetToHereCentimeters(truck.heightFt),
      "vehicle[width]": feetToHereCentimeters(truck.widthFt),
      "vehicle[length]": feetToHereCentimeters(truck.lengthFt),
      "vehicle[axleCount]": String(truck.axleCount),
      "vehicle[trailerCount]": String(truck.trailerCount ?? 1),
      alternatives: String(Math.min(Math.max(input.alternatives ?? 0, 0), 5)),
    });
    if (truck.weightPerAxleLbs) {
      params.set("vehicle[weightPerAxle]", poundsToHereKilograms(truck.weightPerAxleLbs));
    }
    const hazardousGoods = truck.hazardousGoods?.length
      ? truck.hazardousGoods
      : truck.hazmatEnabled ? ["other"] : [];
    if (hazardousGoods.length) params.set("vehicle[shippedHazardousGoods]", hazardousGoods.join(","));
    const avoidFeatures: string[] = [];
    if (truck.avoidTolls) avoidFeatures.push("tollRoad");
    if (truck.avoidFerries) avoidFeatures.push("ferry");
    if (truck.avoidHighways) avoidFeatures.push("controlledAccessHighway");
    if (truck.avoidDirtRoads ?? true) avoidFeatures.push("dirtRoad");
    if (avoidFeatures.length) params.set("avoid[features]", avoidFeatures.join(","));
    if (input.avoidSegments?.length) params.set("avoid[segments]", input.avoidSegments.join(","));
    for (const stop of input.viaStops ?? []) params.append("via", `${stop.lat},${stop.lng}`);

    const response = await fetch(`https://router.hereapi.com/v8/routes?${params}`);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`HERE truck route failed (${response.status}): ${detail}`);
    }
    const data: any = await response.json();
    const routes = Array.isArray(data.routes) ? data.routes.map(parseRoute) : [];
    if (!routes.length) throw new Error("HERE returned no truck-safe route");
    const selected = routes[0];
    return {
      provider: "HERE",
      truckSafe: true,
      navigationAllowed: true,
      trafficAware: true,
      calculatedAt: new Date().toISOString(),
      selectedRouteId: selected.id,
      distanceMiles: selected.distanceMiles,
      etaMinutes: selected.etaMinutes,
      durationSeconds: selected.durationSeconds,
      routeGeometry: selected.routeGeometry,
      legs: selected.legs,
      turnByTurn: selected.turnByTurn,
      alternatives: routes.slice(1),
      alerts: selected.notices.map((notice: { code: string; title?: string }) =>
        `HERE notice ${notice.code}${notice.title ? `: ${notice.title}` : ""}`,
      ),
    };
  }
}
