import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after } from "node:test";

const testDatabaseUrl = process.env.SUBSCRIPTION_TEST_DATABASE_URL;
let disconnectDatabase: (() => Promise<void>) | undefined;

async function loadDatabase() {
  const database = await import("../dist/lib/prisma.js");
  disconnectDatabase ??= database.disconnectDatabase;
  return database;
}

after(async () => {
  await disconnectDatabase?.();
});

test("applied Phase 2 database exposes the capped pilot campaign and entitlement tables", {
  skip: !testDatabaseUrl,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  const { prisma } = await loadDatabase();
  const campaign = await prisma.pilotCampaign.findUnique({ where: { code: "FOUNDING_100" } });
  assert.ok(campaign);
  assert.equal(campaign.redemptionLimit, 100);
  assert.ok(campaign.reservedCount + campaign.redeemedCount <= campaign.redemptionLimit);
  await prisma.entitlementSnapshot.count();
  await prisma.providerEvent.count();
  await prisma.fleetBillingAccount.count();
  await prisma.fleetSeatChange.count();
  await prisma.billingRefund.count();
});

test("database derives one entitlement and rejects stacked welcome offers transactionally", {
  skip: !testDatabaseUrl,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  const { prisma } = await loadDatabase();
  const { recomputeEntitlementSnapshot } = await import("../dist/modules/billing/entitlement.service.js");
  const rollback = new Error("ROLLBACK_TEST_TRANSACTION");
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `phase2-${crypto.randomUUID()}@example.invalid`,
          fullName: "Phase 2 Test",
          passwordHash: "not-a-real-password-hash",
        },
      });
      const shorter = await tx.entitlementSource.create({
        data: {
          userId: user.id,
          provider: "GOOGLE_PLAY",
          sourceType: "SUBSCRIPTION",
          sourceReference: `test-google-${crypto.randomUUID()}`,
          status: "ACTIVE",
          startsAt: new Date("2026-08-01T00:00:00.000Z"),
          accessEndsAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      });
      const longer = await tx.entitlementSource.create({
        data: {
          userId: user.id,
          provider: "APPLE",
          sourceType: "SUBSCRIPTION",
          sourceReference: `test-apple-${crypto.randomUUID()}`,
          status: "ACTIVE",
          startsAt: new Date("2026-08-01T00:00:00.000Z"),
          accessEndsAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      });
      const snapshot = await recomputeEntitlementSnapshot(
        tx,
        user.id,
        "PREMIUM_NAVIGATION",
        new Date("2026-08-31T00:00:00.000Z"),
      );
      assert.notEqual(shorter.id, longer.id);
      assert.equal(snapshot.effectiveSourceId, longer.id);
      assert.equal(snapshot.status, "ACTIVE");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  let uniqueViolation = false;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `phase2-offer-${crypto.randomUUID()}@example.invalid`,
          fullName: "Phase 2 Offer Test",
          passwordHash: "not-a-real-password-hash",
        },
      });
      await tx.subscriptionOfferRedemption.create({
        data: {
          userId: user.id,
          eligibilityGroup: "WELCOME_OFFER",
          offerKind: "REGULAR_TRIAL",
          provider: "GOOGLE_PLAY",
          status: "REDEEMED",
        },
      });
      await tx.subscriptionOfferRedemption.create({
        data: {
          userId: user.id,
          eligibilityGroup: "WELCOME_OFFER",
          offerKind: "PILOT_DISCOUNT",
          provider: "PILOT",
          status: "REDEEMED",
        },
      });
    });
  } catch (error) {
    uniqueViolation = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }
  assert.equal(uniqueViolation, true);
});
