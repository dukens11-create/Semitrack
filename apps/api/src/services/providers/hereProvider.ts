import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { env } from "../../config/env.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(1));
}

/** Decodes a HERE flexible-polyline string into GeoJSON-order [lng, lat] pairs. */
function decodeHereFlexPolyline(encoded: string): number[][] {
  if (!encoded) return [];
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const inv: number[] = new Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    inv[alphabet.charCodeAt(i)] = i;
  }

  let idx = 0;

  function decodeUnsigned(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const code = encoded.charCodeAt(idx++);
      const c = code < 128 ? inv[code] : -1;
      if (c < 0) throw new Error("Invalid HERE flexible polyline character");
      result |= (c & 0x1f) << shift;
      shift += 5;
      if ((c & 0x20) === 0) break;
    }
    return result;
  }

  function decodeSigned(): number {
    const u = decodeUnsigned();
    return (u & 1) !== 0 ? ~(u >> 1) : u >> 1;
  }

  decodeUnsigned(); // skip FORMAT_VERSION
  const headerVal = decodeUnsigned();
  const precision = headerVal & 0x0f;
  const thirdDim = (headerVal >> 4) & 0x07;
  const factor = Math.pow(10, precision);

  let lastLat = 0;
  let lastLng = 0;
  const points: number[][] = [];

  while (idx < encoded.length) {
    lastLat += decodeSigned();
    lastLng += decodeSigned();
    if (thirdDim !== 0) decodeSigned(); // skip altitude / elevation
    // GeoJSON order: [longitude, latitude]
    points.push([lastLng / factor, lastLat / factor]);
  }

  return points;
}

export class HereRouteProvider implements RouteProvider {
  async buildRoute(input: RouteBuildInput): Promise<RouteBuildResult> {
    const params = new URLSearchParams({
      origin: `${input.origin.lat},${input.origin.lng}`,
      destination: `${input.destination.lat},${input.destination.lng}`,
      transportMode: "truck",
      return: "summary,polyline,actions,instructions",
      apiKey: env.hereApiKey,
      "truck[grossWeight]": String(Math.round(input.truck.weightLbs * 0.453592)),
      "truck[height]": String((input.truck.heightFt * 0.3048).toFixed(2)),
      "truck[width]": String((input.truck.widthFt * 0.3048).toFixed(2)),
      "truck[length]": String((input.truck.lengthFt * 0.3048).toFixed(2)),
      "truck[shippedHazardousGoods]": input.truck.hazmatEnabled ? "explosive" : "",
    });

    for (const stop of input.viaStops ?? []) {
      params.append("via", `${stop.lat},${stop.lng}`);
    }

    const url = `https://router.hereapi.com/v8/routes?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HERE route failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const section = data.routes?.[0]?.sections?.[0];
    if (!section) throw new Error("HERE route missing sections");

    const summary = section.summary ?? {};
    const actions = section.actions ?? [];

    return {
      provider: "HERE",
      distanceMiles: metersToMiles(summary.length ?? 0),
      etaMinutes: Math.round((summary.duration ?? 0) / 60),
      routeGeometry: decodeHereFlexPolyline(section.polyline ?? ""),
      turnByTurn: actions.slice(0, 10).map((a: any, index: number) => ({
        step: index + 1,
        instruction: a.instruction ?? a.action ?? "Continue",
        distanceMiles: metersToMiles(a.length ?? 0),
      })),
      alerts: [
        "HERE live truck route calculated",
        input.truck.hazmatEnabled ? "Hazmat profile enabled" : "Hazmat restrictions applied",
      ],
    };
  }
}
