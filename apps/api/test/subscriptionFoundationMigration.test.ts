import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../prisma/migrations/20260831000000_subscription_foundation/migration.sql", import.meta.url),
  "utf8",
);

test("migration enforces one welcome offer and one effective entitlement per user", () => {
  assert.match(migration, /SubscriptionOfferRedemption_userId_eligibilityGroup_key/);
  assert.match(migration, /EntitlementSnapshot_userId_entitlementCode_key/);
});

test("migration enforces the atomic pilot capacity invariant", () => {
  assert.match(migration, /reservedCount" \+ "redeemedCount" <= "redemptionLimit/);
  assert.match(migration, /redemptionLimit" > 0 AND "redemptionLimit" <= 100/);
});

test("migration configures approved regular, pilot and fleet planning prices", () => {
  assert.match(migration, /"priceAmountCents" = 1999/);
  assert.match(migration, /"priceAmountCents" = 19999/);
  assert.match(migration, /'PILOT_MONTHLY'[\s\S]*?999, 'USD', 'MONTH'/);
  assert.match(migration, /1799, 'USD', 'MONTH'/);
  assert.match(migration, /1599, 'USD', 'MONTH'/);
});
