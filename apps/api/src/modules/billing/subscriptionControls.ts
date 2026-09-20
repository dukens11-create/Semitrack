import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createSubscriptionPricing } from "../../contracts/subscriptionPricing.js";
import { BillingFoundationError } from "./billingErrors.js";
import { recomputeEntitlementSnapshot } from "./entitlement.service.js";

const amount = z.number().int().min(1).max(1000000);
export const pricingValuesSchema = z
  .object({
    monthlyRegular: amount,
    monthlyIntro: amount,
    annual: amount,
    fleet1: amount,
    fleet5: amount,
    fleet25: amount,
    fleet100: amount,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.monthlyIntro > v.monthlyRegular)
      ctx.addIssue({
        code: "custom",
        message: "Introductory price cannot exceed the regular price",
      });
    if (v.fleet1 < v.fleet5 || v.fleet5 < v.fleet25 || v.fleet25 < v.fleet100)
      ctx.addIssue({
        code: "custom",
        message: "Volume prices must not increase with fleet size",
      });
  });
export const pricingUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    prices: pricingValuesSchema,
    reason: z.string().trim().min(5).max(500),
    confirmation: z.literal("UPDATE DISPLAY PRICES"),
  })
  .strict();
export const holdUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    suspended: z.boolean(),
    reason: z.string().trim().min(5).max(500),
    confirmation: z.enum(["SUSPEND", "RESTORE"]),
  })
  .strict()
  .refine(
    (v) => v.confirmation === (v.suspended ? "SUSPEND" : "RESTORE"),
    "Confirmation does not match action"
  );

type PriceRow = {
  prices: z.infer<typeof pricingValuesSchema>;
  version: number;
  updatedAt: Date;
};
export async function readPricing() {
  const rows = await prisma.$queryRawUnsafe<PriceRow[]>(
    'SELECT "prices", "version", "updatedAt" FROM "SubscriptionPricingConfig" WHERE "id" = $1',
    "current"
  );
  if (!rows[0])
    throw new BillingFoundationError(
      "PRICING_UNAVAILABLE",
      "Pricing configuration unavailable",
      503
    );
  const prices = pricingValuesSchema.parse(rows[0].prices);
  return { ...rows[0], prices, catalog: createSubscriptionPricing(prices) };
}
export async function updatePricing(
  actorUserId: string,
  input: z.infer<typeof pricingUpdateSchema>
) {
  input = pricingUpdateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = (
      await tx.$queryRawUnsafe<PriceRow[]>(
        'SELECT "prices", "version", "updatedAt" FROM "SubscriptionPricingConfig" WHERE "id"=$1 FOR UPDATE',
        "current"
      )
    )[0];
    if (!before || before.version !== input.expectedVersion)
      throw new BillingFoundationError(
        "PRICING_VERSION_CONFLICT",
        "Refresh pricing before saving",
        409
      );
    const after = (
      await tx.$queryRawUnsafe<PriceRow[]>(
        'UPDATE "SubscriptionPricingConfig" SET "prices"=$1::jsonb,"version"="version"+1,"updatedAt"=NOW() WHERE "id"=$2 RETURNING "prices","version","updatedAt"',
        JSON.stringify(input.prices),
        "current"
      )
    )[0]!;
    await tx.adminAuditLog.create({
      data: {
        actorUserId,
        action: "SUBSCRIPTION_DISPLAY_PRICES_UPDATED",
        targetType: "SUBSCRIPTION_PRICING",
        targetId: "current",
        metadataJson: {
          before: before.prices,
          after: after.prices,
          reason: input.reason,
          version: after.version,
        },
      },
    });
    return { ...after, catalog: createSubscriptionPricing(after.prices) };
  });
}

export type PaymentEvidence = {
  status: string;
  verifiedAt: Date | null;
  gracePeriodEnd: Date | null;
  currentPeriodEnd: Date | null;
};
export function canSuspendForPayment(s: PaymentEvidence, now = new Date()) {
  if (!s.verifiedAt || (s.gracePeriodEnd && s.gracePeriodEnd > now))
    return false;
  return (
    s.status === "PAST_DUE" ||
    (["GRACE_PERIOD", "BILLING_RETRY"].includes(s.status) &&
      Boolean(s.gracePeriodEnd && s.gracePeriodEnd <= now))
  );
}
export function canRestorePaidAccess(s: PaymentEvidence, now = new Date()) {
  return Boolean(
    s.verifiedAt &&
      ["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(s.status) &&
      s.currentPeriodEnd &&
      s.currentPeriodEnd > now
  );
}
export async function setSubscriptionHold(
  actorUserId: string,
  id: string,
  input: z.infer<typeof holdUpdateSchema>
) {
  input = holdUpdateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const found = await tx.subscription.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!found)
      throw new BillingFoundationError(
        "SUBSCRIPTION_NOT_FOUND",
        "Subscription not found",
        404
      );
    // Same lock order as verified provider updates: user, then subscription.
    await tx.$queryRawUnsafe(
      'SELECT id FROM "User" WHERE id=$1 FOR UPDATE',
      found.userId
    );
    await tx.$queryRawUnsafe(
      'SELECT id FROM "Subscription" WHERE id=$1 FOR UPDATE',
      id
    );
    const s = await tx.subscription.findUniqueOrThrow({ where: { id } });
    const before = (
      await tx.$queryRawUnsafe<Array<{ version: number; suspended: boolean }>>(
        'SELECT "version","suspended" FROM "SubscriptionAccessHold" WHERE "subscriptionId"=$1',
        id
      )
    )[0];
    if ((before?.version ?? 0) !== input.expectedVersion)
      throw new BillingFoundationError(
        "HOLD_VERSION_CONFLICT",
        "Refresh the subscription before changing access",
        409
      );
    if (input.suspended ? !canSuspendForPayment(s) : !canRestorePaidAccess(s))
      throw new BillingFoundationError(
        "PAYMENT_EVIDENCE_REQUIRED",
        input.suspended
          ? "Verified overdue payment after grace expiry is required"
          : "Current verified paid access is required before restoring",
        409
      );
    const version = (before?.version ?? 0) + 1;
    await tx.$executeRawUnsafe(
      'INSERT INTO "SubscriptionAccessHold" ("subscriptionId","suspended","reason","version") VALUES ($1,$2,$3,$4) ON CONFLICT ("subscriptionId") DO UPDATE SET "suspended"=$2,"reason"=$3,"version"=$4,"updatedAt"=NOW()',
      id,
      input.suspended,
      input.reason,
      version
    );
    await tx.adminAuditLog.create({
      data: {
        actorUserId,
        action: input.suspended
          ? "SUBSCRIPTION_ACCESS_SUSPENDED"
          : "SUBSCRIPTION_ACCESS_RESTORED",
        targetType: "SUBSCRIPTION",
        targetId: id,
        metadataJson: {
          reason: input.reason,
          version,
          previousSuspended: before?.suspended ?? false,
          providerStatus: s.status,
        },
      },
    });
    const entitlement = await recomputeEntitlementSnapshot(tx, s.userId);
    return {
      suspended: input.suspended,
      version,
      entitlementStatus: entitlement.status,
    };
  });
}
