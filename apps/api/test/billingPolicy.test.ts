import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyVerifiedRefund,
  entitlementCacheDeadline,
  fleetPricingTier,
  hasPilotTrialConflict,
  isEntitlementSourceActive,
  planFleetSeatChange,
  pilotCapacityAvailable,
  selectEffectiveEntitlementSource,
  shouldApplyProviderEvent,
  stripeGracePeriodEnd,
} from "../src/modules/billing/billingPolicy.ts";

const now = new Date("2026-08-31T12:00:00.000Z");
const future = new Date("2026-09-30T12:00:00.000Z");
const later = new Date("2026-10-31T12:00:00.000Z");
const past = new Date("2026-08-30T12:00:00.000Z");

function source(id: string, status: string, accessEndsAt: Date | null = future) {
  return { id, status, startsAt: past, accessEndsAt, gracePeriodEndsAt: null };
}

test("trial, active, grace, retry and cancel-at-period-end sources grant only inside their window", () => {
  for (const status of ["TRIALING", "ACTIVE", "GRACE_PERIOD", "BILLING_RETRY", "CANCEL_AT_PERIOD_END"]) {
    assert.equal(isEntitlementSourceActive(source(status, status), now), true, status);
  }
  for (const status of ["INACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "EXPIRED", "REFUNDED", "REVOKED"]) {
    assert.equal(isEntitlementSourceActive(source(status, status), now), false, status);
  }
  assert.equal(isEntitlementSourceActive(source("expired-window", "ACTIVE", past), now), false);
});

test("grace and billing retry can extend access to their explicit grace deadline", () => {
  const grace = { ...source("grace", "GRACE_PERIOD", past), gracePeriodEndsAt: future };
  assert.equal(isEntitlementSourceActive(grace, now), true);
  assert.equal(isEntitlementSourceActive(grace, later), false);
});

test("one effective source is selected even when several providers are active", () => {
  const selected = selectEffectiveEntitlementSource([
    source("google", "ACTIVE", future),
    source("apple", "ACTIVE", later),
    source("refunded", "REFUNDED", null),
  ], now);
  assert.equal(selected?.id, "apple");
});

test("offline cache is bounded by entitlement expiry", () => {
  const expiresSoon = new Date(now.getTime() + 60 * 60_000);
  assert.equal(entitlementCacheDeadline(now, expiresSoon, 24, 5).toISOString(), expiresSoon.toISOString());
  assert.equal(
    entitlementCacheDeadline(now, null, 24, 5).toISOString(),
    new Date(now.getTime() + 5 * 60_000).toISOString(),
  );
});

test("pilot capacity never exceeds or underflows the 100-user limit", () => {
  assert.equal(pilotCapacityAvailable({ redemptionLimit: 100, reservedCount: 99, redeemedCount: 0 }), 1);
  assert.equal(pilotCapacityAvailable({ redemptionLimit: 100, reservedCount: 20, redeemedCount: 80 }), 0);
  assert.equal(pilotCapacityAvailable({ redemptionLimit: 100, reservedCount: 20, redeemedCount: 81 }), 0);
});

test("older and equal provider events cannot replace newer subscription state", () => {
  const applied = new Date("2026-08-31T11:00:00.000Z");
  assert.equal(shouldApplyProviderEvent(applied, new Date("2026-08-31T11:00:01.000Z")), true);
  assert.equal(shouldApplyProviderEvent(applied, applied), false);
  assert.equal(shouldApplyProviderEvent(applied, new Date("2026-08-31T10:59:59.000Z")), false);
});

test("pilot subscriptions cannot stack any form of seven-day trial", () => {
  assert.equal(hasPilotTrialConflict({ offerKind: "PILOT_DISCOUNT", status: "TRIALING" }), true);
  assert.equal(hasPilotTrialConflict({ sourceType: "PILOT", status: "ACTIVE", trialEnd: future }), true);
  assert.equal(hasPilotTrialConflict({ catalogPlanCode: "PILOT_MONTHLY", status: "ACTIVE", trialStart: now }), true);
  assert.equal(hasPilotTrialConflict({ offerKind: "PILOT_DISCOUNT", status: "ACTIVE" }), false);
  assert.equal(hasPilotTrialConflict({ offerKind: "REGULAR_TRIAL", status: "TRIALING", trialEnd: future }), false);
});

test("Stripe failed-payment access is capped at the configured three-day grace period", () => {
  const failedAt = new Date("2026-09-01T10:00:00.000Z");
  assert.equal(
    stripeGracePeriodEnd(failedAt, 3).toISOString(),
    "2026-09-04T10:00:00.000Z",
  );
});

test("fleet pricing selects the approved tier and requires sales at 100 seats", () => {
  assert.deepEqual(fleetPricingTier(4), { code: "FLEET_1_4", unitPriceCents: 1999, requiresSalesContact: false });
  assert.deepEqual(fleetPricingTier(5), { code: "FLEET_5_24", unitPriceCents: 1799, requiresSalesContact: false });
  assert.deepEqual(fleetPricingTier(25), { code: "FLEET_25_99", unitPriceCents: 1599, requiresSalesContact: false });
  assert.deepEqual(fleetPricingTier(100), { code: "FLEET_100_PLUS", unitPriceCents: null, requiresSalesContact: true });
});

test("fleet increases await provider acceptance and decreases wait for renewal", () => {
  const renewal = new Date("2026-10-01T00:00:00.000Z");
  const increase = planFleetSeatChange({
    currentQuantity: 4,
    requestedQuantity: 5,
    requiredAssignedSeats: 4,
    currentPeriodEnd: renewal,
  });
  assert.equal(increase.type, "INCREASE");
  assert.equal(increase.prorationBehavior, "create_prorations");
  assert.equal(increase.grantBeforeProviderAcceptance, false);
  assert.equal(increase.initialStatus, "AWAITING_PROVIDER");

  const decrease = planFleetSeatChange({
    currentQuantity: 8,
    requestedQuantity: 6,
    requiredAssignedSeats: 6,
    currentPeriodEnd: renewal,
  });
  assert.equal(decrease.type, "DECREASE");
  assert.equal(decrease.prorationBehavior, "none");
  assert.equal(decrease.effectiveAt, renewal);
  assert.equal(decrease.retainCurrentSeatsUntilEffectiveAt, true);
  assert.throws(() => planFleetSeatChange({
    currentQuantity: 8,
    requestedQuantity: 5,
    requiredAssignedSeats: 6,
    currentPeriodEnd: renewal,
  }), /unassigned/);
});

test("verified refund classification follows the approved access policy", () => {
  assert.deepEqual(classifyVerifiedRefund({
    refundAmountCents: 500,
    originalAmountCents: 1999,
    subscriptionCanceledOrRevoked: false,
  }), {
    isFullRefund: false,
    disposition: "RETAIN_ACCESS",
    administratorReviewRequired: false,
    revokeEntitlement: false,
  });
  assert.equal(classifyVerifiedRefund({
    refundAmountCents: 1999,
    originalAmountCents: 1999,
    subscriptionCanceledOrRevoked: false,
  }).disposition, "ADMIN_REVIEW_REQUIRED");
  assert.equal(classifyVerifiedRefund({
    refundAmountCents: 1999,
    originalAmountCents: 1999,
    subscriptionCanceledOrRevoked: true,
  }).revokeEntitlement, true);
});
