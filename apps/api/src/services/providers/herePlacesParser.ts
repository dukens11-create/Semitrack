export type HerePlaceCategory =
  | "walmart_store"
  | "weigh_station"
  | "truck_stop"
  | "rest_area"
  | "fuel_stop"
  | "truck_parking"
  | "truck_wash";

export type HerePlace = {
  id: string;
  name: string;
  category: HerePlaceCategory;
  latitude: number;
  longitude: number;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  distanceMeters?: number;
  provider: "HERE";
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// HERE discovery queries can return an ordinary filling station for a broad
// "truck diesel fuel" search. Only names that explicitly identify a truck stop,
// travel center, or established commercial-truck network are safe to publish as
// a truck service in SemiTrack.
const commercialTruckStopName =
  /(truck\s*stop|travel\s*(?:center|centre|plaza)|pilot|flying\s*j|love'?s|travelcenters?\s+of\s+america|(?:^|\s)ta(?:\s|$)|petro|sapp\s*bros|road\s*ranger|ambest|iowa\s*80|bosselman)/i;

export function parseHerePlaces(payload: unknown, category: HerePlaceCategory): HerePlace[] {
  const body = payload as { items?: unknown[] } | null;
  if (!body || !Array.isArray(body.items)) return [];
  const results: HerePlace[] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const position = item.position as Record<string, unknown> | undefined;
    const address = item.address as Record<string, unknown> | undefined;
    const latitude = asFiniteNumber(position?.lat);
    const longitude = asFiniteNumber(position?.lng);
    const id = asString(item.id);
    const name = asString(item.title);
    if (latitude === undefined || longitude === undefined || !id || !name) continue;
    if (category === "walmart_store" && !/walmart/i.test(name)) continue;
    if (
      (category === "truck_stop" || category === "fuel_stop") &&
      !commercialTruckStopName.test(name)
    ) continue;
    if (
      category === "weigh_station" &&
      !/(weigh station|inspection station|port of entry)/i.test(name)
    ) continue;
    results.push({
      id: `here:${id}`,
      name,
      category,
      latitude,
      longitude,
      address: asString(address?.label) ?? "",
      city: asString(address?.city),
      state: asString(address?.state) ?? asString(address?.stateCode),
      country: asString(address?.countryCode),
      distanceMeters: asFiniteNumber(item.distance),
      provider: "HERE",
    });
  }
  return results;
}
