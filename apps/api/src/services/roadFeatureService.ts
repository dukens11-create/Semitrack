export type RoadFeatureKind =
  | "TRAFFIC_SIGNAL"
  | "STOP_SIGN"
  | "YIELD_SIGN"
  | "WARNING_SIGN"
  | "RAILROAD_CROSSING"
  | "SPEED_LIMIT"
  | "ROAD_SIGN";

export type RoadFeature = {
  id: string;
  kind: RoadFeatureKind;
  title: string;
  latitude: number;
  longitude: number;
  direction?: string;
  value?: string;
  provider: "OpenStreetMap";
  sourceUrl: string;
  lastUpdated?: string;
  distanceMeters: number;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  timestamp?: string;
  tags?: Record<string, string>;
};

type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  items: RoadFeature[];
};
const cache = new Map<string, CacheEntry>();
const cacheTtlMs = 10 * 60 * 1000;
const staleCacheTtlMs = 6 * 60 * 60 * 1000;
const providerFailureBackoffMs = 30 * 1000;
const providerRateLimitBackoffMs = 5 * 60 * 1000;
let providerBackoffUntil = 0;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function signValue(tags: Record<string, string>) {
  return tags.traffic_sign
    ?? tags["traffic_sign:forward"]
    ?? tags["traffic_sign:backward"]
    ?? "";
}

function classify(tags: Record<string, string>): { kind: RoadFeatureKind; title: string; value?: string } | null {
  const highway = (tags.highway ?? "").toLowerCase();
  const railway = (tags.railway ?? "").toLowerCase();
  const rawSign = signValue(tags);
  const sign = rawSign.toLowerCase();
  const hazard = (tags.hazard ?? "").replaceAll("_", " ").trim();

  if (highway === "traffic_signals") return { kind: "TRAFFIC_SIGNAL", title: "Traffic signal" };
  if (highway === "stop" || sign.includes("stop")) return { kind: "STOP_SIGN", title: "Stop sign" };
  if (highway === "give_way" || sign.includes("give_way") || sign.includes("yield")) {
    return { kind: "YIELD_SIGN", title: "Yield sign" };
  }
  if (railway === "level_crossing" || railway === "crossing") {
    return { kind: "RAILROAD_CROSSING", title: "Railroad crossing" };
  }
  if (sign.includes("maxspeed") || tags.maxspeed) {
    const value = tags.maxspeed ?? rawSign.match(/\[([^\]]+)\]/)?.[1];
    return { kind: "SPEED_LIMIT", title: value ? `Speed limit ${value}` : "Speed limit", value };
  }
  if (hazard || /(^|;)us(?::[a-z]{2})?:w\d/i.test(rawSign) || sign.includes("warning")) {
    return {
      kind: "WARNING_SIGN",
      title: hazard ? `${hazard.charAt(0).toUpperCase()}${hazard.slice(1)}` : "Road warning",
      value: rawSign || undefined,
    };
  }
  if (rawSign || highway === "traffic_sign") {
    return { kind: "ROAD_SIGN", title: tags.name ?? "Road sign", value: rawSign || undefined };
  }
  return null;
}

export function normalizeOsmRoadFeatures(
  elements: OverpassElement[],
  center: { lat: number; lng: number },
  radiusMeters: number,
  limit = 300,
) {
  const candidates = elements.flatMap((element): RoadFeature[] => {
    if (element.type !== "node" || element.lat == null || element.lon == null) return [];
    const classification = classify(element.tags ?? {});
    if (!classification) return [];
    const distance = distanceMeters(center.lat, center.lng, element.lat, element.lon);
    if (distance > radiusMeters) return [];
    return [{
      id: `osm-node-${element.id}`,
      ...classification,
      latitude: element.lat,
      longitude: element.lon,
      direction: element.tags?.direction
        ?? element.tags?.["traffic_signals:direction"]
        ?? element.tags?.["stop:direction"],
      provider: "OpenStreetMap",
      sourceUrl: `https://www.openstreetmap.org/node/${element.id}`,
      lastUpdated: element.timestamp,
      distanceMeters: distance,
    }];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Signal sets and all-way stops often contain several nodes only a few
  // metres apart. Keep one icon per kind/intersection to avoid map clutter.
  const deduped: RoadFeature[] = [];
  for (const candidate of candidates) {
    const duplicate = deduped.some((item) =>
      item.kind === candidate.kind
      && distanceMeters(item.latitude, item.longitude, candidate.latitude, candidate.longitude) < 28,
    );
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function overpassQuery(lat: number, lng: number, radiusMeters: number) {
  const around = `around:${Math.round(radiusMeters)},${lat},${lng}`;
  return `[out:json][timeout:16];(`
    + `node(${around})[highway=traffic_signals];`
    + `node(${around})[highway=stop];`
    + `node(${around})[highway=give_way];`
    + `node(${around})[highway=traffic_sign];`
    + `node(${around})[traffic_sign];`
    + `node(${around})[hazard];`
    + `node(${around})[railway=level_crossing];`
    + `node(${around})[railway=crossing];`
    + `);out meta;`;
}

export async function loadRoadFeaturesNearby(input: {
  lat: number;
  lng: number;
  radiusMeters: number;
  limit?: number;
}) {
  const radiusMeters = Math.min(Math.max(input.radiusMeters, 250), 5_000);
  const limit = Math.min(Math.max(input.limit ?? 300, 1), 500);
  const cacheKey = `${input.lat.toFixed(3)}:${input.lng.toFixed(3)}:${Math.round(radiusMeters / 250)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items.slice(0, limit);
  if (providerBackoffUntil > Date.now()) {
    return cached && cached.staleUntil > Date.now()
      ? cached.items.slice(0, limit)
      : [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  let failureBackoffMs = providerFailureBackoffMs;
  try {
    const response = await fetch(process.env.OVERPASS_API_URL ?? "https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "SemiTrack/1.0 (commercial-truck road context)",
      },
      body: new URLSearchParams({ data: overpassQuery(input.lat, input.lng, radiusMeters) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      failureBackoffMs = response.status === 429
        ? providerRateLimitBackoffMs
        : providerFailureBackoffMs;
      throw new Error(`Road feature provider returned HTTP ${response.status}`);
    }
    const data = await response.json() as { elements?: OverpassElement[] };
    const items = normalizeOsmRoadFeatures(data.elements ?? [], input, radiusMeters, 500);
    providerBackoffUntil = 0;
    cache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      staleUntil: Date.now() + staleCacheTtlMs,
      items,
    });
    return items.slice(0, limit);
  } catch (error) {
    providerBackoffUntil = Date.now() + failureBackoffMs;
    const reason = error instanceof Error && error.name === "AbortError"
      ? "request timed out"
      : error instanceof Error
        ? error.message
        : "unknown provider error";
    console.warn(
      `[RoadFeatures] Optional provider unavailable; using ${cached ? "stale cache" : "empty result"}: ${reason}`,
    );
    return cached && cached.staleUntil > Date.now()
      ? cached.items.slice(0, limit)
      : [];
  } finally {
    clearTimeout(timeout);
  }
}
