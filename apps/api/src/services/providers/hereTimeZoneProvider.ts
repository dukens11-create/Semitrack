import { env } from "../../config/env.js";
import { parseHereTimeZone, type HereTimeZone } from "./hereTimeZoneParser.js";

export async function resolveHereTimeZone(
  latitude: number,
  longitude: number,
): Promise<HereTimeZone> {
  if (!env.hereApiKey) throw new Error("HERE_API_KEY is not configured");
  const params = new URLSearchParams({
    at: `${latitude},${longitude}`,
    show: "tz",
    lang: "en-US",
    apiKey: env.hereApiKey,
  });
  const response = await fetch(
    `https://revgeocode.search.hereapi.com/v1/revgeocode?${params}`,
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `HERE destination time-zone lookup failed (${response.status}): ${detail}`,
    );
  }
  return parseHereTimeZone(await response.json());
}