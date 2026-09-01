import assert from "node:assert/strict";
import test from "node:test";
import { BillingFoundationError } from "../dist/modules/billing/billingErrors.js";
import { applyVerifiedSubscriptionUpdate } from "../dist/modules/billing/subscriptionFoundation.service.js";

test("verified pilot subscription updates reject a stacked trial before database work", async () => {
  await assert.rejects(
    applyVerifiedSubscriptionUpdate({
      provider: "STRIPE",
      providerEventId: "evt-test-pilot-trial",
      eventType: "customer.subscription.created",
      rawPayload: "{}",
      eventCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
      userId: "not-used-before-policy-validation",
      providerSubscriptionId: "sub-test-pilot-trial",
      productId: "pilot-test-product",
      catalogPlanCode: "PILOT_MONTHLY",
      plan: "GOLD",
      status: "TRIALING",
      environment: "TEST",
      sourceType: "PILOT",
      offerKind: "PILOT_DISCOUNT",
      trialStart: new Date("2026-09-01T00:00:00.000Z"),
      trialEnd: new Date("2026-09-08T00:00:00.000Z"),
    }),
    (error) => error instanceof BillingFoundationError && error.code === "PILOT_TRIAL_NOT_ALLOWED",
  );
});
