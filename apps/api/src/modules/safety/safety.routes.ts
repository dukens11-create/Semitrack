import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  aggregateCommunityStatus,
  directionMatches,
  distanceMeters,
  expiresAtForReport,
  matchItemsToRoute,
  type Coordinate,
} from "../../services/safetyDataService.js";
import { refreshDotProviders } from "../../services/dotFeedService.js";
import { loadRoadFeaturesNearby } from "../../services/roadFeatureService.js";

export const safetyRouter = Router();

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const roadFeatureNearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().min(250).max(5_000).default(3_000),
  limit: z.number().int().min(1).max(500).default(300),
});

safetyRouter.post("/road-features/nearby", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = roadFeatureNearbySchema.parse(req.body);
    const items = await loadRoadFeaturesNearby(input);
    res.json({
      items,
      provider: "OpenStreetMap",
      attribution: "© OpenStreetMap contributors",
      advisory: "Road-control locations are map context, not authoritative truck restrictions.",
    });
  } catch (error) { next(error); }
}));
const corridorSchema = z.object({
  route: z.array(coordinateSchema).min(2).max(20_000),
  maxCorridorMeters: z.number().min(50).max(25_000).default(2_500),
  currentRouteOffsetMeters: z.number().min(0).default(0),
  maxDistanceAheadMeters: z.number().min(100).max(1_000_000).default(160_934),
  routeBearing: z.number().min(0).max(360).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

const valueByType = {
  WEIGH_STATION_STATUS: ["OPEN", "CLOSED", "INSPECTION"],
  PARKING_AVAILABILITY: ["PLENTY", "SOME", "ALMOST_FULL", "FULL"],
  DIESEL_PRICE: ["DIESEL"],
  RESTRICTION_CORRECTION: [
    "MISSING_LOW_BRIDGE", "INCORRECT_CLEARANCE", "ROAD_NOT_TRUCK_SAFE",
    "REMOVED_RESTRICTION", "TEMPORARY_CLOSURE", "NEW_WEIGHT_RESTRICTION",
  ],
  ROAD_CONDITION: ["CLOSURE", "CONSTRUCTION", "SNOW", "ICE", "HIGH_WIND", "FLOOD", "OTHER"],
} as const;

function bounds(route: Coordinate[], bufferMeters: number) {
  const latitudeBuffer = bufferMeters / 111_320;
  const middleLatitude = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const longitudeBuffer = bufferMeters / Math.max(1, 111_320 * Math.cos(middleLatitude * Math.PI / 180));
  return {
    minLat: Math.min(...route.map((point) => point.lat)) - latitudeBuffer,
    maxLat: Math.max(...route.map((point) => point.lat)) + latitudeBuffer,
    minLng: Math.min(...route.map((point) => point.lng)) - longitudeBuffer,
    maxLng: Math.max(...route.map((point) => point.lng)) + longitudeBuffer,
  };
}

function corridorResponse<T extends { latitude: number; longitude: number; direction?: string | null }>(
  input: z.infer<typeof corridorSchema>,
  records: T[],
) {
  return matchItemsToRoute(
    input.route,
    records,
    (record) => ({ lat: record.latitude, lng: record.longitude }),
    input.maxCorridorMeters,
    input.currentRouteOffsetMeters,
  )
    .filter((match) => match.routeOffsetMeters - input.currentRouteOffsetMeters <= input.maxDistanceAheadMeters)
    .filter((match) => directionMatches(match.item.direction, input.routeBearing))
    .slice(0, input.limit)
    .map((match) => ({
      ...match.item,
      routeDistanceAheadMeters: match.routeOffsetMeters - input.currentRouteOffsetMeters,
      detourOffsetMeters: match.distanceFromRouteMeters,
    }));
}

async function communityAggregate(type: keyof typeof valueByType, entityId: string, official?: { value: string; updatedAt: Date; maxAgeMinutes: number } | null) {
  const reports = await prisma.communityDataReport.findMany({
    where: {
      type,
      entityId,
      expiresAt: { gt: new Date() },
      moderationStatus: { in: ["PENDING", "APPROVED"] },
    },
    include: { votes: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return aggregateCommunityStatus(reports.map((report) => ({
    value: report.value,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
    latitude: report.latitude,
    longitude: report.longitude,
    confirmations: report.votes.filter((vote) => vote.value === "CONFIRM").length,
    disagreements: report.votes.filter((vote) => vote.value === "DISAGREE").length,
    moderated: report.moderationStatus === "PENDING" || report.moderationStatus === "APPROVED",
    reliability: report.confidence,
  })), new Date(), official);
}

safetyRouter.post("/restrictions/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const items = await prisma.truckRestriction.findMany({
      where: {
        active: true,
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLng, lte: box.maxLng },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      take: 1_000,
    });
    res.json({ items: corridorResponse(input, items) });
  } catch (error) { next(error); }
}));

safetyRouter.get("/restrictions/:id", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const item = await prisma.truckRestriction.findUnique({ where: { id } });
    if (!item || !item.active) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Restriction not found" } });
    res.json(item);
  } catch (error) { next(error); }
}));

safetyRouter.post("/weigh-stations/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const stations = await prisma.weighStation.findMany({
      where: {
        isActive: true,
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLng, lte: box.maxLng },
      },
      take: 1_000,
    });
    const matched = corridorResponse(input, stations);
    const withStatus = await Promise.all(matched.map(async (station) => ({
      ...station,
      currentStatus: await communityAggregate(
        "WEIGH_STATION_STATUS",
        station.id,
        station.officialStatus !== "UNKNOWN" && station.lastStatusUpdate
          ? { value: station.officialStatus, updatedAt: station.lastStatusUpdate, maxAgeMinutes: 15 }
          : null,
      ),
    })));
    res.json({ items: withStatus });
  } catch (error) { next(error); }
}));

safetyRouter.get("/weigh-stations/nearby", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusMeters: z.coerce.number().min(100).max(160_934).default(80_467),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);
    const box = bounds([{ lat: input.lat, lng: input.lng }], input.radiusMeters);
    const items = (await prisma.weighStation.findMany({
      where: { isActive: true, latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      take: 500,
    }))
      .map((station) => ({ ...station, distanceMeters: distanceMeters(input, { lat: station.latitude, lng: station.longitude }) }))
      .filter((station) => station.distanceMeters <= input.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, input.limit);
    res.json({ items });
  } catch (error) { next(error); }
}));

safetyRouter.post("/parking/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const locations = await prisma.parkingLocation.findMany({
      where: { active: true, latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      take: 1_000,
    });
    const matched = corridorResponse(input, locations);
    res.json({ items: await Promise.all(matched.map(async (location) => ({
      ...location,
      currentAvailability: await communityAggregate(
        "PARKING_AVAILABILITY",
        location.id,
        location.providerAvailability !== "UNKNOWN" && location.providerUpdatedAt
          ? { value: location.providerAvailability, updatedAt: location.providerUpdatedAt, maxAgeMinutes: 15 }
          : null,
      ),
    }))) });
  } catch (error) { next(error); }
}));

safetyRouter.post("/fuel/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.extend({ maxPriceAgeHours: z.number().min(1).max(168).default(24) }).parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const stations = await prisma.fuelStation.findMany({
      where: { active: true, latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      include: {
        prices: {
          where: { fuelType: "DIESEL", expiresAt: { gt: new Date() }, observedAt: { gt: new Date(Date.now() - input.maxPriceAgeHours * 3_600_000) } },
          orderBy: [{ verified: "desc" }, { observedAt: "desc" }],
          take: 1,
        },
      },
      take: 1_000,
    });
    res.json({ items: corridorResponse(input, stations) });
  } catch (error) { next(error); }
}));

safetyRouter.post("/road-events/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const events = await prisma.dotRoadEvent.findMany({
      where: {
        active: true,
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLng, lte: box.maxLng },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      take: 1_000,
    });
    res.json({ items: corridorResponse(input, events) });
  } catch (error) { next(error); }
}));

safetyRouter.post("/cameras/corridor", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = corridorSchema.parse(req.body);
    const box = bounds(input.route, input.maxCorridorMeters);
    const cameras = await prisma.trafficCamera.findMany({
      where: { active: true, latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      take: 1_000,
    });
    res.json({ items: corridorResponse(input, cameras) });
  } catch (error) { next(error); }
}));

const reportSchema = z.object({
  type: z.enum(["WEIGH_STATION_STATUS", "PARKING_AVAILABILITY", "DIESEL_PRICE", "RESTRICTION_CORRECTION", "ROAD_CONDITION"]),
  entityId: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(80),
  numericValue: z.number().min(0.5).max(25).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  note: z.string().trim().max(500).optional(),
  sourceContext: z.record(z.unknown()).optional(),
});

safetyRouter.post("/community-reports", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const input = reportSchema.parse(req.body);
    if (!(valueByType[input.type] as readonly string[]).includes(input.value)) {
      return res.status(400).json({ error: { code: "INVALID_REPORT_VALUE", message: "Unsupported report value" } });
    }
    if (input.type === "DIESEL_PRICE" && input.numericValue == null) {
      return res.status(400).json({ error: { code: "PRICE_REQUIRED", message: "A diesel price is required" } });
    }
    let target: { latitude: number; longitude: number } | null = null;
    if (input.type === "WEIGH_STATION_STATUS") {
      target = await prisma.weighStation.findUnique({ where: { id: input.entityId }, select: { latitude: true, longitude: true } });
    } else if (input.type === "PARKING_AVAILABILITY") {
      target = await prisma.parkingLocation.findUnique({ where: { id: input.entityId }, select: { latitude: true, longitude: true } });
    } else if (input.type === "DIESEL_PRICE") {
      target = await prisma.fuelStation.findUnique({ where: { id: input.entityId }, select: { latitude: true, longitude: true } });
    }
    if (target) {
      if (input.latitude == null || input.longitude == null) {
        return res.status(400).json({ error: { code: "REPORT_LOCATION_REQUIRED", message: "A current GPS fix is required" } });
      }
      const proximity = distanceMeters(
        { lat: input.latitude, lng: input.longitude },
        { lat: target.latitude, lng: target.longitude },
      );
      if (proximity > 32_187) {
        return res.status(403).json({ error: { code: "REPORT_TOO_FAR_AWAY", message: "You must be near the location to report it" } });
      }
    } else if (["WEIGH_STATION_STATUS", "PARKING_AVAILABILITY", "DIESEL_PRICE"].includes(input.type)) {
      return res.status(404).json({ error: { code: "ENTITY_NOT_FOUND", message: "The reported location was not found" } });
    }
    if (input.note && (/https?:\/\//i.test(input.note) || /(.)\1{12,}/.test(input.note))) {
      return res.status(400).json({ error: { code: "SPAM_REJECTED", message: "The report note was rejected" } });
    }
    const duplicate = await prisma.communityDataReport.findFirst({
      where: {
        userId: req.user!.userId,
        type: input.type,
        entityId: input.entityId,
        createdAt: { gt: new Date(Date.now() - 2 * 60_000) },
      },
    });
    if (duplicate) return res.status(409).json({ error: { code: "DUPLICATE_REPORT", message: "Wait before reporting this location again" } });
    const reporter = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.userId },
      select: { reportTrustScore: true },
    });
    const report = await prisma.communityDataReport.create({
      data: {
        userId: req.user!.userId,
        type: input.type,
        entityId: input.entityId,
        value: input.value,
        numericValue: input.numericValue,
        latitude: input.latitude,
        longitude: input.longitude,
        note: input.note,
        sourceContextJson: input.sourceContext as object | undefined,
        confidence: reporter.reportTrustScore,
        expiresAt: expiresAtForReport(input.type, input.value),
      },
    });
    res.status(201).json(report);
  } catch (error) { next(error); }
}));

safetyRouter.put("/community-reports/:id/vote", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const { value } = z.object({ value: z.enum(["CONFIRM", "DISAGREE"]) }).parse(req.body);
    const id = z.string().min(1).parse(req.params.id);
    const report = await prisma.communityDataReport.findUnique({ where: { id } });
    if (!report || report.expiresAt <= new Date()) return res.status(404).json({ error: { code: "REPORT_NOT_ACTIVE", message: "Report is missing or expired" } });
    if (report.userId === req.user!.userId) return res.status(409).json({ error: { code: "SELF_VOTE", message: "You cannot vote on your own report" } });
    const vote = await prisma.communityDataVote.upsert({
      where: { reportId_userId: { reportId: report.id, userId: req.user!.userId } },
      create: { reportId: report.id, userId: req.user!.userId, value },
      update: { value },
    });
    res.json(vote);
  } catch (error) { next(error); }
}));

safetyRouter.get("/community-reports/:type/:entityId/aggregate", requireAuth, asyncRoute(async (req, res, next) => {
  try {
    const type = z.enum(["WEIGH_STATION_STATUS", "PARKING_AVAILABILITY", "DIESEL_PRICE", "RESTRICTION_CORRECTION", "ROAD_CONDITION"]).parse(req.params.type);
    const entityId = z.string().min(1).parse(req.params.entityId);
    res.json(await communityAggregate(type, entityId));
  } catch (error) { next(error); }
}));

safetyRouter.patch("/admin/community-reports/:id", requireAuth, requireRole(["ADMIN", "MODERATOR", "FLEET_ADMIN"]), asyncRoute(async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["APPROVED", "REJECTED", "REMOVED", "EXPIRED"]), reason: z.string().trim().min(2).max(500) }).parse(req.body);
    const id = z.string().min(1).parse(req.params.id);
    const report = await prisma.communityDataReport.update({
      where: { id },
      data: { moderationStatus: input.status, moderationReason: input.reason },
    });
    res.json(report);
  } catch (error) { next(error); }
}));

safetyRouter.get("/admin/provider-status", requireAuth, requireRole(["ADMIN", "MODERATOR", "FLEET_ADMIN"]), asyncRoute(async (_req, res, next) => {
  try {
    res.json({ items: await prisma.providerSyncState.findMany({ orderBy: [{ status: "asc" }, { lastSuccessAt: "asc" }] }) });
  } catch (error) { next(error); }
}));

safetyRouter.post("/admin/provider-sync", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN"]), asyncRoute(async (_req, res, next) => {
  try {
    const results = await refreshDotProviders(true);
    res.json({ items: results.map((result) => result.status === "fulfilled"
      ? { ok: true, ...result.value }
      : { ok: false, error: result.reason instanceof Error ? result.reason.message : "Provider failed" }) });
  } catch (error) { next(error); }
}));
