import crypto from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  getAdminDashboard,
  getAdminDriverProfile,
  getFinancialAnalytics,
  parseAnalyticsRange,
} from "./adminAnalytics.service.js";

export const adminAnalyticsRouter = Router();
export const telemetryRouter = Router();

const dashboardRoles = ["ADMIN", "FLEET_ADMIN", "MODERATOR"];
const operationalRoles = ["ADMIN", "FLEET_ADMIN"];

function parseRangeOrRespond(query: Record<string, unknown>, res: Response) {
  try {
    return parseAnalyticsRange(query);
  } catch (error) {
    res.status(400).json({ error: { code: "INVALID_DATE_RANGE", message: error instanceof Error ? error.message : "Invalid analytics date range" } });
    return null;
  }
}

async function audit(actorUserId: string, action: string, targetType: string, targetId: string | null, ipAddress: string | undefined, metadataJson?: Record<string, unknown>) {
  await prisma.adminAuditLog.create({
    data: { actorUserId, action, targetType, targetId, ipAddress, metadataJson: metadataJson as any },
  });
}

adminAnalyticsRouter.get("/dashboard", requireAuth, requireRole(dashboardRoles), async (req, res, next) => {
  try {
    const range = parseRangeOrRespond(req.query, res);
    if (!range) return;
    const includeFinancial = req.user!.role === "ADMIN";
    const data = await getAdminDashboard(range, includeFinancial);
    if (includeFinancial) {
      await audit(req.user!.userId, "FINANCIAL_DASHBOARD_VIEWED", "ANALYTICS", null, req.ip, { range: range.preset, from: range.from, to: range.to });
    }
    res.json(data);
  } catch (error) {
    next(error);
  }
});

adminAnalyticsRouter.get("/financial", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const range = parseRangeOrRespond(req.query, res);
    if (!range) return;
    const data = await getFinancialAnalytics(range);
    await audit(req.user!.userId, "FINANCIAL_ANALYTICS_VIEWED", "ANALYTICS", null, req.ip, { range: range.preset, from: range.from, to: range.to });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

adminAnalyticsRouter.get("/drivers/:driverId", requireAuth, requireRole(operationalRoles), async (req, res, next) => {
  try {
    const includeFinancial = req.user!.role === "ADMIN";
    const driverId = String(req.params.driverId);
    const profile = await getAdminDriverProfile(driverId, includeFinancial);
    if (!profile) return res.status(404).json({ error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
    await audit(req.user!.userId, "DRIVER_ANALYTICS_VIEWED", "USER", driverId, req.ip, { financialDataIncluded: includeFinancial });
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

const eventSchema = z.object({
  clientEventId: z.string().uuid().optional(),
  eventType: z.enum(["APP_OPENED", "FUEL_STOP_SEARCH", "PARKING_SEARCH", "TRUCK_STOP_SELECTED", "HOS_WARNING_SHOWN"]),
  entityId: z.string().trim().min(1).max(160).optional(),
  stateRegion: z.string().trim().min(2).max(80).optional(),
  numericValue: z.number().finite().optional(),
  durationSeconds: z.number().int().min(0).max(31_536_000).optional(),
  metadata: z.object({ label: z.string().trim().min(1).max(160).optional() }).strict().optional(),
}).strict();

telemetryRouter.post("/events", requireAuth, async (req, res, next) => {
  try {
    const input = eventSchema.parse(req.body);
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AppAnalyticsEvent" (id, "clientEventId", "userId", "eventType", "entityId", "stateRegion", "numericValue", "durationSeconds", "metadataJson", "occurredAt", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
       ON CONFLICT ("clientEventId") DO NOTHING`,
      id, input.clientEventId ?? null, req.user!.userId, input.eventType, input.entityId ?? null,
      input.stateRegion ?? null, input.numericValue ?? null, input.durationSeconds ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );
    res.status(202).json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

const navigationStartSchema = z.object({
  clientSessionId: z.string().uuid(),
  tripId: z.string().min(1).max(120).optional(),
  estimatedDriveMinutes: z.number().int().min(0).max(100_000).optional(),
  stateRegion: z.string().trim().min(2).max(80).optional(),
}).strict();

telemetryRouter.post("/navigation-sessions", requireAuth, async (req, res, next) => {
  try {
    const input = navigationStartSchema.parse(req.body);
    if (input.tripId) {
      const owned = await prisma.trip.findFirst({ where: { id: input.tripId, userId: req.user!.userId }, select: { id: true } });
      if (!owned) return res.status(404).json({ error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
    }
    const id = crypto.randomUUID();
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "NavigationSession" (id, "clientSessionId", "userId", "tripId", status, "estimatedDriveMinutes", "stateRegion", "startedAt", "lastHeartbeatAt", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,NOW(),NOW(),NOW(),NOW())
       ON CONFLICT ("clientSessionId") DO UPDATE SET "lastHeartbeatAt" = NOW(), "updatedAt" = NOW()
       WHERE "NavigationSession"."userId" = EXCLUDED."userId"
       RETURNING id`,
      id, input.clientSessionId, req.user!.userId, input.tripId ?? null, input.estimatedDriveMinutes ?? null, input.stateRegion ?? null,
    );
    if (!rows[0]) return res.status(409).json({ error: { code: "SESSION_ID_CONFLICT", message: "Navigation session identifier is already in use" } });
    res.status(201).json({ id: rows[0].id });
  } catch (error) {
    next(error);
  }
});

const navigationUpdateSchema = z.object({
  estimatedDriveMinutes: z.number().int().min(0).max(100_000).optional(),
  actualDistanceMiles: z.number().min(0).max(10_000_000).optional(),
  actualDurationSeconds: z.number().int().min(0).max(31_536_000).optional(),
  stateRegion: z.string().trim().min(2).max(80).optional(),
  hosWarningShown: z.boolean().optional(),
}).strict();

telemetryRouter.post("/navigation-sessions/:id/heartbeat", requireAuth, async (req, res, next) => {
  try {
    const input = navigationUpdateSchema.parse(req.body);
    const changed = await prisma.$executeRawUnsafe(
      `UPDATE "NavigationSession" SET
        "estimatedDriveMinutes" = COALESCE($1, "estimatedDriveMinutes"),
        "actualDistanceMiles" = COALESCE($2, "actualDistanceMiles"),
        "actualDurationSeconds" = COALESCE($3, "actualDurationSeconds"),
        "stateRegion" = COALESCE($4, "stateRegion"),
        "hosWarningShownAt" = CASE WHEN $5 THEN COALESCE("hosWarningShownAt", NOW()) ELSE "hosWarningShownAt" END,
        "lastHeartbeatAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $6 AND "userId" = $7 AND status = 'ACTIVE'`,
      input.estimatedDriveMinutes ?? null, input.actualDistanceMiles ?? null, input.actualDurationSeconds ?? null,
      input.stateRegion ?? null, input.hosWarningShown ?? false, String(req.params.id), req.user!.userId,
    );
    if (!changed) return res.status(404).json({ error: { code: "NAVIGATION_SESSION_NOT_FOUND", message: "Active navigation session not found" } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

telemetryRouter.post("/navigation-sessions/:id/end", requireAuth, async (req, res, next) => {
  try {
    const input = navigationUpdateSchema.extend({ status: z.enum(["COMPLETED", "CANCELED"]) }).parse(req.body);
    const changed = await prisma.$executeRawUnsafe(
      `UPDATE "NavigationSession" SET status = $1,
        "estimatedDriveMinutes" = COALESCE($2, "estimatedDriveMinutes"),
        "actualDistanceMiles" = COALESCE($3, "actualDistanceMiles"),
        "actualDurationSeconds" = COALESCE($4, "actualDurationSeconds"),
        "stateRegion" = COALESCE($5, "stateRegion"),
        "hosWarningShownAt" = CASE WHEN $6 THEN COALESCE("hosWarningShownAt", NOW()) ELSE "hosWarningShownAt" END,
        "lastHeartbeatAt" = NOW(), "endedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $7 AND "userId" = $8 AND status = 'ACTIVE'`,
      input.status, input.estimatedDriveMinutes ?? null, input.actualDistanceMiles ?? null,
      input.actualDurationSeconds ?? null, input.stateRegion ?? null, input.hosWarningShown ?? false,
      String(req.params.id), req.user!.userId,
    );
    if (!changed) return res.status(404).json({ error: { code: "NAVIGATION_SESSION_NOT_FOUND", message: "Active navigation session not found" } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
