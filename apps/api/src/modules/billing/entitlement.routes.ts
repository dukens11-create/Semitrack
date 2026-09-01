import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireTestBillingMode } from "./billingMode.middleware.js";
import {
  getEffectiveEntitlementForUser,
  recomputeEntitlementSnapshot,
  serializeEntitlement,
} from "./entitlement.service.js";
import { BillingFoundationError } from "./billingErrors.js";

export const entitlementRouter = Router();
export const adminEntitlementRouter = Router();

entitlementRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    res.setHeader("cache-control", "private, no-store");
    const entitlement = await getEffectiveEntitlementForUser(req.user!.userId);
    res.json(serializeEntitlement(entitlement));
  } catch (error) {
    next(error);
  }
});

const grantSchema = z.object({
  userId: z.string().trim().min(1),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  reason: z.string().trim().min(5).max(500),
}).strict().superRefine((value, context) => {
  const startsAt = value.startsAt ?? new Date();
  if (value.endsAt && value.endsAt <= startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Grant end must be after its start" });
  }
});

adminEntitlementRouter.post(
  "/grants",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = grantSchema.parse(req.body);
      const startsAt = input.startsAt ?? new Date();
      const sourceReference = `admin_grant:${crypto.randomUUID()}`;
      const result = await prisma.$transaction(async (tx) => {
        const users = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE
        `;
        if (!users[0]) throw new BillingFoundationError("USER_NOT_FOUND", "User not found", 404);
        const source = await tx.entitlementSource.create({
          data: {
            userId: input.userId,
            provider: "ADMIN_GRANT",
            sourceType: "ADMIN_GRANT",
            sourceReference,
            status: "ACTIVE",
            startsAt,
            accessEndsAt: input.endsAt ?? null,
            lastVerifiedAt: new Date(),
            metadataJson: { reason: input.reason },
          },
        });
        await tx.billingAuditLog.create({
          data: {
            actorUserId: req.user!.userId,
            action: "ADMIN_ENTITLEMENT_GRANTED",
            targetType: "ENTITLEMENT_SOURCE",
            targetId: source.id,
            provider: "ADMIN_GRANT",
            ipAddress: req.ip,
            metadataJson: {
              userId: input.userId,
              startsAt: startsAt.toISOString(),
              endsAt: input.endsAt?.toISOString() ?? null,
              reason: input.reason,
            },
          },
        });
        const entitlement = await recomputeEntitlementSnapshot(tx, input.userId);
        return { source, entitlement };
      });
      res.status(201).json({ source: result.source, entitlement: serializeEntitlement(result.entitlement) });
    } catch (error) {
      next(error);
    }
  },
);

const revokeSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

adminEntitlementRouter.post(
  "/grants/:id/revoke",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = revokeSchema.parse(req.body);
      const sourceId = String(req.params.id);
      const result = await prisma.$transaction(async (tx) => {
        const source = await tx.entitlementSource.findFirst({
          where: { id: sourceId, provider: "ADMIN_GRANT", sourceType: "ADMIN_GRANT" },
        });
        if (!source) throw new BillingFoundationError("GRANT_NOT_FOUND", "Administrative grant not found", 404);
        if (source.status === "REVOKED") {
          return { source, entitlement: await recomputeEntitlementSnapshot(tx, source.userId) };
        }
        const revokedAt = new Date();
        const updated = await tx.entitlementSource.update({
          where: { id: source.id },
          data: { status: "REVOKED", revokedAt },
        });
        await tx.billingAuditLog.create({
          data: {
            actorUserId: req.user!.userId,
            action: "ADMIN_ENTITLEMENT_REVOKED",
            targetType: "ENTITLEMENT_SOURCE",
            targetId: source.id,
            provider: "ADMIN_GRANT",
            ipAddress: req.ip,
            metadataJson: { userId: source.userId, reason: input.reason },
          },
        });
        return { source: updated, entitlement: await recomputeEntitlementSnapshot(tx, source.userId) };
      });
      res.json({ source: result.source, entitlement: serializeEntitlement(result.entitlement) });
    } catch (error) {
      next(error);
    }
  },
);

adminEntitlementRouter.get(
  "/users/:userId",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const userId = String(req.params.userId);
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new BillingFoundationError("USER_NOT_FOUND", "User not found", 404);
      const [sources, entitlement] = await Promise.all([
        prisma.entitlementSource.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
        getEffectiveEntitlementForUser(userId),
      ]);
      res.json({ entitlement: serializeEntitlement(entitlement), sources });
    } catch (error) {
      next(error);
    }
  },
);
