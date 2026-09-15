export type Coordinate = { lat: number; lng: number };

export type CorridorMatch<T> = {
  item: T;
  routeOffsetMeters: number;
  distanceFromRouteMeters: number;
};

export type CommunityEvidence = {
  value: string;
  createdAt: Date;
  expiresAt: Date;
  latitude?: number | null;
  longitude?: number | null;
  confirmations: number;
  disagreements: number;
  moderated: boolean;
  reliability?: number;
};

export type AggregatedCommunityStatus = {
  value: string;
  source: "OFFICIAL_LIVE" | "COMMUNITY" | "UNKNOWN";
  confidence: number;
  lastReportedAt: Date | null;
  confirmations: number;
  disagreements: number;
  stale: boolean;
};

export const reportTtlMinutes: Readonly<Record<string, number>> = {
  WEIGH_STATION_OPEN: 60,
  WEIGH_STATION_CLOSED: 60,
  WEIGH_STATION_INSPECTION: 30,
  PARKING_PLENTY: 45,
  PARKING_SOME: 45,
  PARKING_ALMOST_FULL: 30,
  PARKING_FULL: 30,
  DIESEL_PRICE: 24 * 60,
  RESTRICTION_CORRECTION: 7 * 24 * 60,
  ROAD_CONDITION: 120,
};

const earthRadiusMeters = 6_371_008.8;

const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(a: Coordinate, b: Coordinate) {
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const h = Math.sin(lat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectToSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const latitudeScale = 111_320;
  const longitudeScale = Math.max(1, latitudeScale * Math.cos(radians(point.lat)));
  const x = (point.lng - start.lng) * longitudeScale;
  const y = (point.lat - start.lat) * latitudeScale;
  const dx = (end.lng - start.lng) * longitudeScale;
  const dy = (end.lat - start.lat) * latitudeScale;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));
  const projected = { lat: start.lat + (end.lat - start.lat) * fraction, lng: start.lng + (end.lng - start.lng) * fraction };
  return { fraction, distance: distanceMeters(point, projected) };
}

export function matchItemsToRoute<T>(
  route: Coordinate[],
  items: T[],
  coordinateOf: (item: T) => Coordinate,
  maxCorridorMeters: number,
  currentRouteOffsetMeters = 0,
) {
  if (route.length < 2) return [] as CorridorMatch<T>[];
  const cumulative = [0];
  for (let index = 1; index < route.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + distanceMeters(route[index - 1]!, route[index]!));
  }
  const matches: CorridorMatch<T>[] = [];
  for (const item of items) {
    const point = coordinateOf(item);
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestOffset = 0;
    for (let index = 1; index < route.length; index += 1) {
      const projected = projectToSegment(point, route[index - 1]!, route[index]!);
      if (projected.distance < bestDistance) {
        bestDistance = projected.distance;
        bestOffset = cumulative[index - 1]!
          + (cumulative[index]! - cumulative[index - 1]!) * projected.fraction;
      }
    }
    if (bestDistance <= maxCorridorMeters && bestOffset >= currentRouteOffsetMeters) {
      matches.push({ item, routeOffsetMeters: bestOffset, distanceFromRouteMeters: bestDistance });
    }
  }
  return matches.sort((a, b) => a.routeOffsetMeters - b.routeOffsetMeters);
}

export function directionMatches(stationDirection?: string | null, routeBearing?: number | null) {
  if (!stationDirection || routeBearing == null) return true;
  const normalized = stationDirection.trim().toUpperCase();
  const directionBearing: Record<string, number> = {
    N: 0, NORTH: 0, NB: 0,
    E: 90, EAST: 90, EB: 90,
    S: 180, SOUTH: 180, SB: 180,
    W: 270, WEST: 270, WB: 270,
    NE: 45, SE: 135, SW: 225, NW: 315,
  };
  const expected = directionBearing[normalized];
  if (expected == null) return true;
  const difference = Math.abs(((routeBearing - expected + 540) % 360) - 180);
  return difference <= 75;
}

export function expiresAtForReport(type: string, value: string, now = new Date()) {
  const key = type === "DIESEL_PRICE" || type === "RESTRICTION_CORRECTION" || type === "ROAD_CONDITION"
    ? type
    : `${type.replace("_STATUS", "").replace("_AVAILABILITY", "")}_${value}`;
  const minutes = reportTtlMinutes[key] ?? 60;
  return new Date(now.getTime() + minutes * 60_000);
}

export function aggregateCommunityStatus(
  reports: CommunityEvidence[],
  now = new Date(),
  official?: { value: string; updatedAt: Date; maxAgeMinutes: number } | null,
): AggregatedCommunityStatus {
  if (official && now.getTime() - official.updatedAt.getTime() <= official.maxAgeMinutes * 60_000) {
    return {
      value: official.value,
      source: "OFFICIAL_LIVE",
      confidence: 1,
      lastReportedAt: official.updatedAt,
      confirmations: 0,
      disagreements: 0,
      stale: false,
    };
  }
  const active = reports.filter((report) => report.expiresAt > now && report.moderated);
  if (!active.length) {
    return { value: "UNKNOWN", source: "UNKNOWN", confidence: 0, lastReportedAt: null, confirmations: 0, disagreements: 0, stale: true };
  }
  const scores = new Map<string, { score: number; latest: Date; confirmations: number; disagreements: number }>();
  for (const report of active) {
    const ttl = Math.max(1, report.expiresAt.getTime() - report.createdAt.getTime());
    const freshness = Math.max(0, Math.min(1, (report.expiresAt.getTime() - now.getTime()) / ttl));
    const voteWeight = 1 + report.confirmations * 0.35 - report.disagreements * 0.45;
    const reliability = Math.max(0.1, Math.min(1, report.reliability ?? 0.5));
    const score = Math.max(0.05, freshness * voteWeight * reliability);
    const current = scores.get(report.value) ?? { score: 0, latest: report.createdAt, confirmations: 0, disagreements: 0 };
    current.score += score;
    if (report.createdAt > current.latest) current.latest = report.createdAt;
    current.confirmations += report.confirmations;
    current.disagreements += report.disagreements;
    scores.set(report.value, current);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [value, winner] = ranked[0]!;
  const total = ranked.reduce((sum, entry) => sum + entry[1].score, 0);
  return {
    value,
    source: "COMMUNITY",
    confidence: Math.max(0, Math.min(0.95, winner.score / Math.max(total, 0.01))),
    lastReportedAt: winner.latest,
    confirmations: winner.confirmations,
    disagreements: winner.disagreements,
    stale: false,
  };
}

/** Advisory queries only: reject ambiguous loop/intersection progress rather than guess. */
export function correlateRoutePosition(route: Coordinate[], point: Coordinate) {
  const match = matchItemsToRoute(route, [point], p => p, 250)[0];
  if (!match) throw new Error("ROUTE_LOCATION_UNCORRELATED");
  let traversed = 0;
  for (let i = 1; i < route.length; i++) {
    const start = route[i - 1]!, end = route[i]!;
    const segment = distanceMeters(start, end);
    const projected = projectToSegment(point, start, end);
    if (projected.distance <= 100 && Math.abs(traversed + segment * projected.fraction - match.routeOffsetMeters) > 1000)
      throw new Error("ROUTE_LOCATION_AMBIGUOUS");
    traversed += segment;
  }
  return match.routeOffsetMeters;
}

export function pointAtRouteOffset(route: Coordinate[], offset: number): Coordinate | null {
  if (!Number.isFinite(offset) || offset < 0 || route.length < 2) return null;
  let remaining = offset;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!, length = distanceMeters(a, b);
    if (Math.abs(b.lng - a.lng) > 180) return null;
    if (length > 0 && remaining <= length) {
      const fraction = remaining / length;
      return {lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction};
    }
    remaining -= length;
  }
  return null;
}

const corridorMessages = {
  CORRIDOR_ROUTE_REQUIRED: "A valid non-empty planned route is required for corridor information.",
  CORRIDOR_LOCATION_REQUIRED: "Current location is required for corridor information.",
  CORRIDOR_LOCATION_INVALID: "A valid precise location is required for corridor information.",
  CORRIDOR_LOCATION_STALE: "Location is stale. Acquire a fresh precise fix and retry corridor information.",
  CORRIDOR_LOCATION_OFF_ROUTE: "Current location is not on the planned route. Review the route and retry.",
  CORRIDOR_LOCATION_AMBIGUOUS: "Progress on this route is ambiguous. Acquire a new location and review the route.",
  CORRIDOR_CORRELATION_FAILED: "Location could not be correlated with the planned route. Review and retry.",
} as const;
export class CorridorCorrelationError extends Error {
  readonly httpStatus = 422;
  readonly code: keyof typeof corridorMessages;
  constructor(code: keyof typeof corridorMessages) { super(corridorMessages[code]); this.code = code; }
}
/** Shared advisory correlation boundary; never substitutes zero progress after an error. */
export function corridorRouteOffset(route: unknown, location: unknown, now = Date.now()): number {
  const coordinate = (value: any): value is Coordinate => !!value &&
    typeof value.lat === "number" && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
    typeof value.lng === "number" && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
  if (!Array.isArray(route) || route.length < 2 || route.length > 20000 || !route.every(coordinate) ||
    !route.some(point => distanceMeters(point, route[0]!) > 0)) throw new CorridorCorrelationError("CORRIDOR_ROUTE_REQUIRED");
  if (location == null) throw new CorridorCorrelationError("CORRIDOR_LOCATION_REQUIRED");
  const fix = location as Coordinate & {accuracy: number; timestamp: number};
  if (!coordinate(fix) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100 ||
    !Number.isFinite(fix.timestamp) || fix.timestamp > now + 5000) throw new CorridorCorrelationError("CORRIDOR_LOCATION_INVALID");
  if (now - fix.timestamp > 15000) throw new CorridorCorrelationError("CORRIDOR_LOCATION_STALE");
  try { return correlateRoutePosition(route, fix); }
  catch (error) {
    const reason = error instanceof Error ? error.message : "";
    throw new CorridorCorrelationError(reason === "ROUTE_LOCATION_AMBIGUOUS" ? "CORRIDOR_LOCATION_AMBIGUOUS" :
      reason === "ROUTE_LOCATION_UNCORRELATED" ? "CORRIDOR_LOCATION_OFF_ROUTE" : "CORRIDOR_CORRELATION_FAILED");
  }
}
