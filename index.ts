import express from "express";
import cors from "cors";
import { z } from "zod";
import { drivers, documents, fuelStations, loads, parkingLots, pois, weighStations } from "./data/mockDb.js";
import { buildFuelPlan, buildHosPlan, buildTruckRoute } from "./services/routingService.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Semitrack API",
    status: "ok",
    modules: [
      "routing",
      "trip-planner",
      "poi",
      "parking",
      "fuel",
      "weigh-stations",
      "alerts",
      "weather",
      "fleet",
      "load-board",
      "documents",
      "subscriptions"
    ]
  });
});

const routeSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  viaStops: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
  truck: z.object({
    heightFt: z.number(),
    weightLbs: z.number(),
    widthFt: z.number(),
    lengthFt: z.number(),
    hazmatEnabled: z.boolean(),
    axleCount: z.number(),
    avoidTolls: z.boolean().optional(),
    avoidFerries: z.boolean().optional(),
    avoidResidential: z.boolean().optional()
  }),
  routeMode: z.enum(["fastest", "fuel_optimized", "shortest"]).optional(),
  avoidZones: z.array(z.string()).optional()
});

app.post("/routing/truck-route", (req, res) => {
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid route payload", details: parsed.error.flatten() });
  }
  return res.json(buildTruckRoute(parsed.data));
});

app.post("/routing/reroute", (req, res) => {
  const { routeId, alertId } = req.body ?? {};
  return res.json({
    routeId,
    alertId,
    rerouted: true,
    message: "Route recalculated around active hazard/closure."
  });
});

app.post("/trip-planner/create", (req, res) => {
  const { name = "New Trip", origin, destination, stops = [] } = req.body ?? {};
  const distanceMiles = 702;
  const etaMinutes = 780;

  return res.json({
    id: "trip_123",
    name,
    origin,
    destination,
    stops,
    distanceMiles,
    etaMinutes,
    hosPlan: buildHosPlan(distanceMiles, etaMinutes),
    fuelPlan: buildFuelPlan(distanceMiles),
    routePreview: "encoded_polyline_here",
    saved: true
  });
});

app.get("/poi/nearby", (req, res) => {
  const category = String(req.query.category ?? "");
  const filtered = category ? pois.filter((p) => p.category === category) : pois;
  res.json({ total: filtered.length, items: filtered });
});

app.post("/poi/review", (req, res) => {
  res.json({
    success: true,
    reviewId: "review_001",
    ...req.body
  });
});

app.get("/parking", (_req, res) => {
  res.json({ items: parkingLots });
});

app.post("/parking/report", (req, res) => {
  res.json({
    success: true,
    reportId: "parking_report_1",
    message: "Parking report submitted successfully.",
    ...req.body
  });
});

app.get("/fuel/nearby", (_req, res) => {
  const cheapest = [...fuelStations].sort((a, b) => a.dieselPrice - b.dieselPrice)[0];
  res.json({ items: fuelStations, cheapest });
});

app.get("/weigh-stations/nearby", (_req, res) => {
  res.json({ items: weighStations });
});

app.get("/alerts/route/:routeId", (req, res) => {
  res.json({
    routeId: req.params.routeId,
    alerts: [
      { type: "LOW_BRIDGE", title: "Low Bridge Ahead", severity: "critical", mileMarker: 132 },
      { type: "WEATHER", title: "High Wind Advisory", severity: "high", mileMarker: 188 },
      { type: "TRAFFIC", title: "Congestion Ahead", severity: "medium", mileMarker: 205 }
    ]
  });
});

app.post("/weather/route", (_req, res) => {
  res.json({
    summary: "Mixed weather along route",
    checkpoints: [
      { mileMarker: 0, condition: "Clear", tempF: 56 },
      { mileMarker: 120, condition: "Rain", tempF: 48 },
      { mileMarker: 260, condition: "Snow risk", tempF: 31 }
    ],
    alerts: [
      { type: "storm", severity: "moderate", message: "Possible thunderstorm in 2 hours" }
    ]
  });
});

app.get("/fleet/live", (_req, res) => {
  res.json({
    companyId: "company_1",
    drivers
  });
});

app.get("/load-board/search", (_req, res) => {
  res.json({ total: loads.length, loads });
});

app.get("/documents/company", (_req, res) => {
  res.json({ companyId: "company_1", items: documents });
});

app.get("/subscriptions/plans", (_req, res) => {
  res.json({
    plans: [
      { code: "FREE", priceMonthly: 0, features: ["basic map", "basic POI", "limited routing"] },
      { code: "GOLD", priceMonthly: 29.99, features: ["truck routing", "parking", "fuel", "weather"] },
      { code: "DIAMOND", priceMonthly: 59.99, features: ["advanced routing", "offline maps", "fleet", "analytics"] },
      { code: "TEAM", priceMonthly: 199.99, features: ["multi-driver fleet", "company dashboard", "reports", "documents"] }
    ]
  });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Semitrack API running on http://localhost:${port}`);
});
