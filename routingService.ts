import type { RouteRequest } from "../types.js";
import { distanceMiles } from "../data/mockDb.js";

export function buildTruckRoute(dto: RouteRequest) {
  const distance = distanceMiles(dto.origin, dto.destination);
  const routeMode = dto.routeMode ?? "fastest";
  const speedMph = routeMode === "fuel_optimized" ? 52 : routeMode === "shortest" ? 50 : 56;
  const etaMinutes = Math.round((distance / speedMph) * 60);

  return {
    routeMode,
    distanceMiles: Number(distance.toFixed(1)),
    etaMinutes,
    tollsUsd: routeMode === "shortest" ? 11.0 : 18.5,
    fuelGallonsEstimate: Number((distance / 6.8).toFixed(1)),
    truckWarnings: [
      "Low bridge avoided near Mile 132",
      "Residential road excluded near destination",
      dto.truck.hazmatEnabled ? "Hazmat profile enabled" : "Hazmat restrictions applied"
    ],
    turnByTurn: [
      { step: 1, instruction: "Head north on I-5", distanceMiles: 23.1 },
      { step: 2, instruction: "Keep right for freight corridor", distanceMiles: 16.2 },
      { step: 3, instruction: "Continue on truck-safe route toward destination", distanceMiles: Number((distance - 39.3).toFixed(1)) }
    ],
    laneGuidance: [
      { step: 2, lanes: ["left", "center", "right"], recommended: "center" }
    ],
    junctionViews: [
      { step: 2, imageUrl: "https://example.com/junction-221.png" }
    ],
    alternatives: [
      {
        type: "fastest",
        distanceMiles: Number(distance.toFixed(1)),
        etaMinutes,
        fuelGallonsEstimate: Number((distance / 6.8).toFixed(1))
      },
      {
        type: "fuel_optimized",
        distanceMiles: Number((distance * 1.03).toFixed(1)),
        etaMinutes: Math.round(((distance * 1.03) / 52) * 60),
        fuelGallonsEstimate: Number(((distance * 1.03) / 7.1).toFixed(1))
      }
    ],
    geometry: "encoded_polyline_here",
    live: {
      traffic: "moderate",
      incidents: 2,
      trafficCameras: 3
    }
  };
}

export function buildHosPlan(distance: number, etaMinutes: number) {
  return {
    drivingHoursEstimate: Number((etaMinutes / 60).toFixed(1)),
    mandatoryBreaks: [
      { afterHours: 8, durationMinutes: 30, suggestion: "Stop at truck-safe rest area" }
    ],
    resetSuggestion: distance > 600 ? "Potential overnight reset suggested." : "No overnight reset required."
  };
}

export function buildFuelPlan(distance: number, mpg = 6.8) {
  return {
    totalGallonsEstimate: Number((distance / mpg).toFixed(1)),
    suggestedStops: [
      { mileMarker: 180, gallons: 45, stationType: "truck_stop" },
      { mileMarker: 390, gallons: 50, stationType: "truck_stop" }
    ]
  };
}
