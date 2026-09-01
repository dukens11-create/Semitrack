import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionPlanUpdateSchema } from "../src/modules/subscriptions/subscriptionPlanValidation.ts";

const base = {
  expectedVersion: 1,
  displayName: "SemiTraX Monthly",
  purpose: "Main individual driver plan",
  description: "Premium access",
  priceAmountCents: 1999,
  currency: "usd",
  billingInterval: "MONTH" as const,
  trialDays: 0,
  isActive: true,
  isPublic: true,
  isFeatured: true,
  badge: "BEST VALUE",
  sortOrder: 20,
};

test("accepts an active paid catalog plan and normalizes currency", () => {
  const result = subscriptionPlanUpdateSchema.parse(base);
  assert.equal(result.currency, "USD");
  assert.equal(result.priceAmountCents, 1999);
});

test("requires a positive price for active monthly and annual plans", () => {
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, priceAmountCents: 0 }).success, false);
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "YEAR", priceAmountCents: null }).success, false);
});

test("keeps trial plans free and requires a trial duration", () => {
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "TRIAL", priceAmountCents: 0, trialDays: 7 }).success, true);
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "TRIAL", priceAmountCents: 100, trialDays: 7 }).success, false);
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "TRIAL", priceAmountCents: 0, trialDays: 0 }).success, false);
});

test("allows the configured seven-day trial on regular paid plans", () => {
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, trialDays: 7 }).success, true);
  assert.equal(subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "YEAR", trialDays: 7 }).success, true);
});

test("allows inactive fleet pricing to remain custom", () => {
  const result = subscriptionPlanUpdateSchema.safeParse({ ...base, billingInterval: "CUSTOM", priceAmountCents: null, trialDays: 0, isActive: false });
  assert.equal(result.success, true);
});
