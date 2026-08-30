import { z } from "zod";

export type NormalizedRoadEvent = {
  providerEventId: string;
  title: string;
  description?: string;
  type: "ROAD_CLOSURE" | "CONSTRUCTION" | "INCIDENT" | "CRASH" | "WEATHER" | "SNOW" | "ICE" | "CHAIN_RESTRICTION" | "HIGH_WIND" | "FLOOD" | "TRUCK_RESTRICTION" | "CAMERA" | "MOUNTAIN_PASS" | "OTHER";
  severity: "INFO" | "MINOR" | "MODERATE" | "SEVERE" | "CRITICAL";
  latitude: number;
  longitude: number;
  affectedRoad?: string;
  direction?: string;
  startsAt?: Date;
  endsAt?: Date;
  lastUpdated: Date;
  active: boolean;
  geometry?: unknown;
  sourceUrl?: string;
};

export type NormalizedTrafficCamera = {
  providerCameraId: string;
  name: string;
  roadway?: string;
  direction?: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
  streamUrl?: string;
  lastUpdated: Date;
  active: boolean;
};

export type Dot511Snapshot = {
  events: NormalizedRoadEvent[];
  cameras: NormalizedTrafficCamera[];
  fetchedAt: Date;
};

export interface Dot511Provider {
  readonly id: string;
  readonly jurisdiction: string;
  readonly endpointUrl: string;
  readonly refreshIntervalSec: number;
  fetchSnapshot(): Promise<Dot511Snapshot>;
}

const configSchema = z.object({
  id: z.string().min(1),
  jurisdiction: z.string().length(2).transform((value) => value.toUpperCase()),
  endpointUrl: z.string().url(),
  format: z.enum(["GEOJSON", "ARCGIS_JSON"]),
  refreshIntervalSec: z.number().int().min(60).max(86_400).default(300),
  dataType: z.enum(["ROAD_EVENTS", "CAMERAS"]),
  authorizationHeaderEnv: z.string().min(1).optional(),
  mapping: z.object({
    id: z.string().default("id"),
    title: z.string().default("title"),
    description: z.string().default("description"),
    type: z.string().default("type"),
    severity: z.string().default("severity"),
    road: z.string().default("roadway"),
    direction: z.string().default("direction"),
    startsAt: z.string().default("startTime"),
    endsAt: z.string().default("endTime"),
    updatedAt: z.string().default("lastUpdated"),
    imageUrl: z.string().default("imageUrl"),
    streamUrl: z.string().default("streamUrl"),
  }).default({}),
});

export type DotProviderConfig = z.infer<typeof configSchema>;

const eventTypes = new Set([
  "ROAD_CLOSURE", "CONSTRUCTION", "INCIDENT", "CRASH", "WEATHER", "SNOW",
  "ICE", "CHAIN_RESTRICTION", "HIGH_WIND", "FLOOD", "TRUCK_RESTRICTION",
  "CAMERA", "MOUNTAIN_PASS", "OTHER",
]);
const severities = new Set(["INFO", "MINOR", "MODERATE", "SEVERE", "CRITICAL"]);

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function unpack(data: any, format: DotProviderConfig["format"]) {
  const features = Array.isArray(data) ? data : data?.features;
  if (!Array.isArray(features)) throw new Error("Provider response has no feature array");
  return features.map((feature) => {
    const properties = feature.properties ?? feature.attributes ?? feature;
    const coordinates = feature.geometry?.coordinates;
    const longitude = format === "GEOJSON" ? Number(coordinates?.[0]) : Number(feature.geometry?.x ?? properties.longitude);
    const latitude = format === "GEOJSON" ? Number(coordinates?.[1]) : Number(feature.geometry?.y ?? properties.latitude);
    return { properties, latitude, longitude, geometry: feature.geometry };
  });
}

function date(value: unknown, fallback?: Date) {
  const parsed = value == null ? null : new Date(String(value));
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

export class ConfiguredDot511Provider implements Dot511Provider {
  constructor(readonly config: DotProviderConfig) {}
  get id() { return this.config.id; }
  get jurisdiction() { return this.config.jurisdiction; }
  get endpointUrl() { return this.config.endpointUrl; }
  get refreshIntervalSec() { return this.config.refreshIntervalSec; }

  async fetchSnapshot(): Promise<Dot511Snapshot> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.config.authorizationHeaderEnv) {
      const value = process.env[this.config.authorizationHeaderEnv];
      if (!value) throw new Error(`Missing provider credential environment variable ${this.config.authorizationHeaderEnv}`);
      headers.authorization = value;
    }
    const response = await fetch(this.endpointUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const fetchedAt = new Date();
    const features = unpack(await response.json(), this.config.format)
      .filter((feature) => validCoordinate(feature.latitude, feature.longitude));
    if (this.config.dataType === "CAMERAS") {
      const cameras = features.map(({ properties, latitude, longitude }) => ({
        providerCameraId: String(properties[this.config.mapping.id]),
        name: String(properties[this.config.mapping.title] ?? "Traffic camera"),
        roadway: properties[this.config.mapping.road]?.toString(),
        direction: properties[this.config.mapping.direction]?.toString(),
        latitude,
        longitude,
        imageUrl: properties[this.config.mapping.imageUrl]?.toString(),
        streamUrl: properties[this.config.mapping.streamUrl]?.toString(),
        lastUpdated: date(properties[this.config.mapping.updatedAt], fetchedAt)!,
        active: true,
      })).filter((camera) => camera.providerCameraId && (camera.imageUrl || camera.streamUrl));
      return { events: [], cameras, fetchedAt };
    }
    const events = features.map(({ properties, latitude, longitude, geometry }) => {
      const rawType = String(properties[this.config.mapping.type] ?? "OTHER").toUpperCase().replaceAll(/[^A-Z]+/g, "_");
      const rawSeverity = String(properties[this.config.mapping.severity] ?? "INFO").toUpperCase();
      return {
        providerEventId: String(properties[this.config.mapping.id]),
        title: String(properties[this.config.mapping.title] ?? "Road event"),
        description: properties[this.config.mapping.description]?.toString(),
        type: (eventTypes.has(rawType) ? rawType : "OTHER") as NormalizedRoadEvent["type"],
        severity: (severities.has(rawSeverity) ? rawSeverity : "INFO") as NormalizedRoadEvent["severity"],
        latitude,
        longitude,
        affectedRoad: properties[this.config.mapping.road]?.toString(),
        direction: properties[this.config.mapping.direction]?.toString(),
        startsAt: date(properties[this.config.mapping.startsAt]),
        endsAt: date(properties[this.config.mapping.endsAt]),
        lastUpdated: date(properties[this.config.mapping.updatedAt], fetchedAt)!,
        active: true,
        geometry,
        sourceUrl: this.endpointUrl,
      };
    }).filter((event) => event.providerEventId);
    return { events, cameras: [], fetchedAt };
  }
}

export function parseDotProviderConfigs(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  return z.array(configSchema).parse(parsed);
}
