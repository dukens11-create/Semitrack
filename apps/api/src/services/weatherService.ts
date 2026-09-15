import { z } from "zod";
import { env } from "../config/env.js";
import type { LatLng } from "../types.js";
import {
  correlateRoutePosition,
  pointAtRouteOffset,
  distanceMeters,
} from "./safetyDataService.js";

const coordinate = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
export const routeWeatherSchema = z.object({
  route: z.array(coordinate).min(2).max(20000),
  currentLocation: coordinate.extend({
    accuracy: z.number().min(0).max(100),
    timestamp: z.number().finite(),
  }),
});
const weatherSchema = z.object({
  coord: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  dt: z.number().positive(),
  main: z.object({
    temp: z.number().finite(),
    feels_like: z.number().finite().optional(),
  }),
  weather: z
    .array(
      z.object({
        main: z.string().min(1).max(80),
        description: z.string().max(200),
      })
    )
    .min(1),
  wind: z.object({ speed: z.number().finite().nonnegative() }).optional(),
});
export function parseWeather(
  payload: unknown,
  point: LatLng,
  now = Date.now()
) {
  const data = weatherSchema.parse(payload);
  const observed = data.dt * 1000;
  const providerPoint = { lat: data.coord.lat, lng: data.coord.lon };
  // Advisory area observation, never an arrival-time forecast or exact road condition.
  if (
    observed > now + 300000 ||
    now - observed > 7200000 ||
    distanceMeters(point, providerPoint) > 25000
  )
    throw new Error("WEATHER_DATA_UNCORRELATED_OR_STALE");
  return {
    tempF: data.main.temp,
    feelsLikeF: data.main.feels_like ?? null,
    condition: data.weather[0]!.main,
    description: data.weather[0]!.description,
    windMph: data.wind?.speed ?? null,
    observedAt: new Date(observed).toISOString(),
    provider: "OpenWeather",
    providerPoint,
    status: "AREA_OBSERVATION" as const,
  };
}
export async function getWeatherAtPoint(point: LatLng) {
  if (!env.openWeatherApiKey) throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lng),
    units: "imperial",
    appid: env.openWeatherApiKey,
  });
  try {
    const response = await fetch(
      "https://api.openweathermap.org/data/2.5/weather?" + params,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
    return parseWeather(await response.json(), point);
  } catch {
    throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
  }
}
export async function getRouteWeather(points: LatLng[]) {
  return Promise.all(
    points.map(async (point) => ({
      point,
      ...(await getWeatherAtPoint(point)),
    }))
  );
}
export function routeWeatherSamples(
  input: z.infer<typeof routeWeatherSchema>,
  now = Date.now()
) {
  routeWeatherSchema.parse(input);
  const fix = input.currentLocation;
  if (now - fix.timestamp > 15000 || fix.timestamp > now + 5000)
    throw new Error("FRESH_LOCATION_REQUIRED");
  const offset = correlateRoutePosition(input.route, fix);
  return [
    {
      label: "Current route location",
      point: pointAtRouteOffset(input.route, offset),
    },
    {
      label: "50 miles ahead",
      point: pointAtRouteOffset(input.route, offset + 80467.2),
    },
    {
      label: "100 miles ahead",
      point: pointAtRouteOffset(input.route, offset + 160934.4),
    },
    { label: "Destination", point: input.route[input.route.length - 1]! },
  ];
}
export async function getCorrelatedRouteWeather(
  input: z.infer<typeof routeWeatherSchema>
) {
  let samples;
  try {
    samples = routeWeatherSamples(input);
  } catch {
    return [
      {
        label: "Route weather",
        status: "UNAVAILABLE",
        reason:
          "A fresh location uniquely correlated with the route is required.",
      },
    ];
  }
  return Promise.all(
    samples.map(async (sample) => {
      if (!sample.point)
        return {
          ...sample,
          status: "UNAVAILABLE",
          reason: "This distance extends beyond the remaining route.",
        };
      try {
        return { ...sample, ...(await getWeatherAtPoint(sample.point)) };
      } catch {
        return {
          ...sample,
          status: "UNAVAILABLE",
          reason:
            "Provider data is unavailable, stale or cannot be correlated.",
        };
      }
    })
  );
}
