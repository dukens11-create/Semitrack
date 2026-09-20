import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalyticsRange } from "../src/modules/analytics/analyticsRange.ts";
import { requireIsolatedDatabase } from "./isolatedDatabaseGuard.ts";

const now = new Date("2026-08-22T12:00:00.000Z");

test("parses supported analytics presets with deterministic boundaries", () => {
  const sevenDays = parseAnalyticsRange({ range: "7d" }, now);
  assert.equal(sevenDays.preset, "7d");
  assert.equal(sevenDays.to.toISOString(), now.toISOString());
  assert.equal(sevenDays.from.toISOString(), "2026-08-15T12:00:00.000Z");
  assert.equal(sevenDays.bucket, "day");
});

test("accepts a bounded custom range", () => {
  const custom = parseAnalyticsRange({ range: "custom", from: "2026-08-01T00:00:00Z", to: "2026-08-22T00:00:00Z" }, now);
  assert.equal(custom.from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(custom.to.toISOString(), "2026-08-22T00:00:00.000Z");
});

test("rejects invalid and overlong analytics ranges", () => {
  assert.throws(() => parseAnalyticsRange({ range: "custom", from: "invalid", to: "2026-08-22" }, now));
  assert.throws(() => parseAnalyticsRange({ range: "custom", from: "2020-01-01", to: "2026-08-22" }, now));
  assert.throws(() => parseAnalyticsRange({ range: "lifetime" }, now));
});

test("dashboard labels navigation telemetry as client-reported until native provenance exists", {
  skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL,
}, async () => {
  process.env.DATABASE_URL = requireIsolatedDatabase(
    process.env.SUBSCRIPTION_TEST_DATABASE_URL,
  );
  const { getAdminDashboard } = await import(
    "../dist/modules/analytics/adminAnalytics.service.js"
  );
  const { disconnectDatabase } = await import("../dist/lib/prisma.js");
  try {
    const range = parseAnalyticsRange({ range: "7d" }, now);
    const dashboard = await getAdminDashboard(range, false);
    assert.equal(
      dashboard.coverage.navigationProvenance,
      "CLIENT_REPORTED_UNVERIFIED",
    );
    assert.match(
      dashboard.coverage.note,
      /client-reported/i,
    );
    if (dashboard.kpis.activeTrips.available) {
      assert.match(
        String(dashboard.kpis.activeTrips.reason),
        /client-reported/i,
      );
    }
  } finally {
    await disconnectDatabase();
  }
});

