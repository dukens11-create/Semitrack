import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import {
  readPricing,
  updatePricing,
  pricingUpdateSchema,
  holdUpdateSchema,
  setSubscriptionHold,
  canSuspendForPayment,
  canRestorePaidAccess,
} from "./subscriptionControls.js";
export const subscriptionControlsRouter = Router();
subscriptionControlsRouter.use(requireAuth, requireRole(["ADMIN"]));
subscriptionControlsRouter.use((_req, res, next) => {
  res.setHeader("cache-control", "private, no-store");
  next();
});
subscriptionControlsRouter.get("/pricing", async (_req, res, next) => {
  try {
    res.json(await readPricing());
  } catch (e) {
    next(e);
  }
});
subscriptionControlsRouter.patch("/pricing", async (req, res, next) => {
  try {
    res.json(
      await updatePricing(req.user!.userId, pricingUpdateSchema.parse(req.body))
    );
  } catch (e) {
    next(e);
  }
});
subscriptionControlsRouter.get("/subscriptions", async (req, res, next) => {
  try {
    const query = z
      .object({
        filter: z.enum(["overdue", "all", "suspended"]).default("overdue"),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        search: z.string().trim().max(120).default(""),
      })
      .parse(req.query);
    const holds = await prisma.$queryRawUnsafe<
      Array<{ subscriptionId: string; suspended: boolean; version: number }>
    >(
      'SELECT "subscriptionId","suspended","version" FROM "SubscriptionAccessHold"'
    );
    const where = {
      ...(query.filter === "overdue"
        ? {
            status: {
              in: ["PAST_DUE", "GRACE_PERIOD", "BILLING_RETRY"] as (
                | "PAST_DUE"
                | "GRACE_PERIOD"
                | "BILLING_RETRY"
              )[],
            },
          }
        : {}),
      ...(query.filter === "suspended"
        ? {
            id: {
              in: holds.filter((h) => h.suspended).map((h) => h.subscriptionId),
            },
          }
        : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                {
                  email: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  fullName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        skip: (query.page - 1) * 25,
        take: 25,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          plan: true,
          provider: true,
          status: true,
          environment: true,
          verifiedAt: true,
          gracePeriodEnd: true,
          currentPeriodEnd: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      prisma.subscription.count({ where }),
    ]);
    res.json({
      page: query.page,
      total,
      items: records.map((s) => ({
        ...s,
        hold: holds.find((h) => h.subscriptionId === s.id) ?? {
          version: 0,
          suspended: false,
        },
        canSuspend: canSuspendForPayment(s),
        canRestore: canRestorePaidAccess(s),
      })),
    });
  } catch (e) {
    next(e);
  }
});
subscriptionControlsRouter.patch(
  "/subscriptions/:id/access",
  async (req, res, next) => {
    try {
      res.json(
        await setSubscriptionHold(
          req.user!.userId,
          String(req.params.id),
          holdUpdateSchema.parse(req.body)
        )
      );
    } catch (e) {
      next(e);
    }
  }
);
