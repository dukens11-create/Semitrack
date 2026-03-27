import { env } from "../config/env.js";
import type { LatLng } from "../types.js";

export async function getWeatherAtPoint(point: LatLng) {
  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${point.lat}&lon=${point.lng}` +
    `&units=imperial&appid=${encodeURIComponent(env.openWeatherApiKey)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenWeather failed: ${res.status} ${text}`);
  }

  const data = await res.json();

  return {
    tempF: data.main?.temp ?? null,
    feelsLikeF: data.main?.feels_like ?? null,
    condition: data.weather?.[0]?.main ?? "Unknown",
    description: data.weather?.[0]?.description ?? "Unknown",
    windMph: data.wind?.speed ?? null,
  };
}

export async function getRouteWeather(points: LatLng[]) {
  const samples = await Promise.all(points.map(getWeatherAtPoint));
  return points.map((point, index) => ({
    point,
    ...samples[index],
  }));
}
