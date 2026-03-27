import type { RouteBuildInput, RouteBuildResult } from "../../types.js";
import type { RouteProvider } from "./routeProvider.js";
import { env } from "../../config/env.js";

function metersToMiles(meters: number) {
  return Number((meters / 1609.344).toFixed(1));
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
      routePolyline: section.polyline ?? "",
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
