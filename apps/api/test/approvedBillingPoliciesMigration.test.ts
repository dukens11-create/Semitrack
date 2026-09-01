import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../prisma/migrations/20260901000000_approved_billing_policies/migration.sql", import.meta.url),
  "utf8",
);

test("approved billing migration stores fleet seat changes and enforces assigned-seat minimums", () => {
  assert.match(migration, /CREATE TABLE "FleetBillingAccount"/);
  assert.match(migration, /CREATE TABLE "FleetSeatChange"/);
  assert.match(migration, /"requestedQuantity" >= "requiredAssignedSeats"/);
  assert.match(migration, /"type" = 'INCREASE'/);
  assert.match(migration, /"type" = 'DECREASE'/);
});

test("approved billing migration stores verified refunds and administrator review", () => {
  assert.match(migration, /CREATE TABLE "BillingRefund"/);
  assert.match(migration, /"providerRefundId"/);
  assert.match(migration, /"providerEventId"/);
  assert.match(migration, /"administratorReviewRequired"/);
  assert.match(migration, /BillingRefund_provider_providerEventId_key/);
});
