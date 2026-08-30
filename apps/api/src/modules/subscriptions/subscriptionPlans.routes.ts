import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { subscriptionPlanUpdateSchema } from "./subscriptionPlanValidation.js";

export const publicSubscriptionPlansRouter = Router();
export const adminSubscriptionPlansRouter = Router();

export type SubscriptionPlanRecord = {
  code: string;
  displayName: string;
  purpose: string;
  description: string | null;
  priceAmountCents: number | null;
  currency: string;
  billingInterval: "TRIAL" | "MONTH" | "YEAR" | "CUSTOM";
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  isFeatured: boolean;
  badge: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const planColumns = `"code", "displayName", "purpose", "description", "priceAmountCents", "currency",
  "billingInterval", "trialDays", "isActive", "isPublic", "isFeatured", "badge", "sortOrder", "version", "createdAt", "updatedAt"`;

function normalizeNullable(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length ? normalized : null;
}

async function listPlans(publicOnly: boolean) {
  const where = publicOnly ? `WHERE "isPublic" = true` : "";
  return prisma.$queryRawUnsafe<SubscriptionPlanRecord[]>(
    `SELECT ${planColumns} FROM "SubscriptionPlanCatalog" ${where} ORDER BY "sortOrder", "code"`,
  );
}

publicSubscriptionPlansRouter.get("/", async (_req, res, next) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json({ plans: await listPlans(true) });
  } catch (error) {
    next(error);
  }
});

adminSubscriptionPlansRouter.get("/", requireAuth, requireRole(["ADMIN"]), async (_req, res, next) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json({ plans: await listPlans(false) });
  } catch (error) {
    next(error);
  }
});

adminSubscriptionPlansRouter.patch("/:code", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const code = String(req.params.code).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      return res.status(400).json({ error: { code: "INVALID_PLAN_CODE", message: "Invalid plan code" } });
    }
    const input = subscriptionPlanUpdateSchema.parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const beforeRows = await tx.$queryRawUnsafe<SubscriptionPlanRecord[]>(
        `SELECT ${planColumns} FROM "SubscriptionPlanCatalog" WHERE "code" = $1 FOR UPDATE`, code,
      );
      const before = beforeRows[0];
      if (!before) return { kind: "missing" as const };
      if (before.version !== input.expectedVersion) return { kind: "conflict" as const, current: before };

      const rows = await tx.$queryRawUnsafe<SubscriptionPlanRecord[]>(
        `UPDATE "SubscriptionPlanCatalog" SET
          "displayName" = $3, "purpose" = $4, "description" = $5, "priceAmountCents" = $6,
          "currency" = $7, "billingInterval" = $8, "trialDays" = $9, "isActive" = $10,
          "isPublic" = $11, "isFeatured" = $12, "badge" = $13, "sortOrder" = $14,
          "version" = "version" + 1, "updatedAt" = NOW()
         WHERE "code" = $1 AND "version" = $2 RETURNING ${planColumns}`,
        code, input.expectedVersion, input.displayName, input.purpose, normalizeNullable(input.description),
        input.priceAmountCents, input.currency, input.billingInterval, input.trialDays, input.isActive,
        input.isPublic, input.isFeatured, normalizeNullable(input.badge), input.sortOrder,
      );
      const after = rows[0];
      if (!after) return { kind: "conflict" as const, current: before };
      await tx.adminAuditLog.create({
        data: {
          actorUserId: req.user!.userId,
          action: "SUBSCRIPTION_PLAN_UPDATED",
          targetType: "SUBSCRIPTION_PLAN",
          targetId: code,
          ipAddress: req.ip,
          metadataJson: { before, after } as any,
        },
      });
      return { kind: "updated" as const, plan: after };
    });

    if (updated.kind === "missing") return res.status(404).json({ error: { code: "PLAN_NOT_FOUND", message: "Subscription plan not found" } });
    if (updated.kind === "conflict") return res.status(409).json({ error: { code: "PLAN_VERSION_CONFLICT", message: "This plan was changed by another administrator. Reload and try again." }, plan: updated.current });
    res.json({ plan: updated.plan });
  } catch (error) {
    next(error);
  }
});
