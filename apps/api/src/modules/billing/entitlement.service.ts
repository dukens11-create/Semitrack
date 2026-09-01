import type { EntitlementCode, Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import {
  entitlementCacheDeadline,
  entitlementSourceEnd,
  selectEffectiveEntitlementSource,
} from "./billingPolicy.js";

export type BillingDbClient = Prisma.TransactionClient | PrismaClient;

export async function recomputeEntitlementSnapshot(
  db: BillingDbClient,
  userId: string,
  entitlementCode: EntitlementCode = "PREMIUM_NAVIGATION",
  now = new Date(),
) {
  const sources = await db.entitlementSource.findMany({
    where: { userId, entitlementCode },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });
  const effective = selectEffectiveEntitlementSource(sources, now);
  const effectiveUntil = effective ? entitlementSourceEnd(effective) : null;
  const cacheValidUntil = entitlementCacheDeadline(
    now,
    effectiveUntil,
    env.entitlementOfflineCacheHours,
    env.entitlementNegativeCacheMinutes,
  );

  return db.entitlementSnapshot.upsert({
    where: { userId_entitlementCode: { userId, entitlementCode } },
    create: {
      userId,
      entitlementCode,
      status: effective ? "ACTIVE" : "INACTIVE",
      effectiveSourceId: effective?.id ?? null,
      effectiveFrom: effective?.startsAt ?? null,
      effectiveUntil,
      cacheValidUntil,
      computedAt: now,
    },
    update: {
      status: effective ? "ACTIVE" : "INACTIVE",
      effectiveSourceId: effective?.id ?? null,
      effectiveFrom: effective?.startsAt ?? null,
      effectiveUntil,
      cacheValidUntil,
      computedAt: now,
    },
    include: {
      effectiveSource: {
        include: { subscription: { select: { plan: true } } },
      },
    },
  });
}

export async function getEffectiveEntitlementForUser(
  userId: string,
  entitlementCode: EntitlementCode = "PREMIUM_NAVIGATION",
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;
    return recomputeEntitlementSnapshot(tx, userId, entitlementCode, now);
  });
}

export function serializeEntitlement(snapshot: Awaited<ReturnType<typeof recomputeEntitlementSnapshot>>) {
  const source = snapshot.effectiveSource;
  const active = snapshot.status === "ACTIVE";
  const subscribedPlan = source?.subscription?.plan ?? "FREE";
  const plan = active ? (subscribedPlan === "FREE" ? "GOLD" : subscribedPlan) : "FREE";
  return {
    plan,
    entitlement: snapshot.entitlementCode,
    active,
    status: snapshot.status,
    provider: source?.provider ?? null,
    sourceType: source?.sourceType ?? null,
    sourceStatus: source?.status ?? null,
    effectiveFrom: snapshot.effectiveFrom,
    expiresAt: snapshot.effectiveUntil,
    cacheValidUntil: snapshot.cacheValidUntil,
    verifiedAt: source?.lastVerifiedAt ?? null,
    source: source ? "verified_server_record" : "free_default",
    features: {
      premiumNavigation: active,
      truckRouting: active,
      offlineMaps: active && ["DIAMOND", "TEAM"].includes(plan),
      fleet: active && plan === "TEAM",
    },
  };
}
