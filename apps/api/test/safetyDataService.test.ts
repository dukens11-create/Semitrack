import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCommunityStatus,
  directionMatches,
  expiresAtForReport,
  matchItemsToRoute,
} from "../src/services/safetyDataService.ts";

test("route matching orders locations by actual route progress", () => {
  const route = [{ lat: 40, lng: -120 }, { lat: 40, lng: -119 }, { lat: 41, lng: -119 }];
  const items = [
    { id: "later", lat: 40.8, lng: -119.001 },
    { id: "first", lat: 40.001, lng: -119.5 },
    { id: "far", lat: 41.5, lng: -118 },
  ];
  const matches = matchItemsToRoute(route, items, (item) => item, 1_000);
  assert.deepEqual(matches.map((match) => match.item.id), ["first", "later"]);
});

test("opposite direction is excluded when direction is known", () => {
  assert.equal(directionMatches("EB", 92), true);
  assert.equal(directionMatches("WB", 92), false);
  assert.equal(directionMatches(null, 92), true);
});

test("weigh station status TTL is centralized by status", () => {
  const now = new Date("2026-08-19T00:00:00Z");
  assert.equal(expiresAtForReport("WEIGH_STATION_STATUS", "OPEN", now).toISOString(), "2026-08-19T01:00:00.000Z");
  assert.equal(expiresAtForReport("WEIGH_STATION_STATUS", "INSPECTION", now).toISOString(), "2026-08-19T00:30:00.000Z");
});

test("fresh official status takes precedence over community reports", () => {
  const now = new Date("2026-08-19T01:00:00Z");
  const aggregate = aggregateCommunityStatus([
    {
      value: "CLOSED",
      createdAt: new Date("2026-08-19T00:55:00Z"),
      expiresAt: new Date("2026-08-19T01:55:00Z"),
      confirmations: 8,
      disagreements: 0,
      moderated: true,
    },
  ], now, { value: "OPEN", updatedAt: new Date("2026-08-19T00:58:00Z"), maxAgeMinutes: 15 });
  assert.equal(aggregate.value, "OPEN");
  assert.equal(aggregate.source, "OFFICIAL_LIVE");
});

test("expired, rejected, and conflicting reports are handled safely", () => {
  const now = new Date("2026-08-19T01:00:00Z");
  const aggregate = aggregateCommunityStatus([
    {
      value: "OPEN",
      createdAt: new Date("2026-08-18T22:00:00Z"),
      expiresAt: new Date("2026-08-18T23:00:00Z"),
      confirmations: 20,
      disagreements: 0,
      moderated: true,
    },
    {
      value: "OPEN",
      createdAt: new Date("2026-08-19T00:50:00Z"),
      expiresAt: new Date("2026-08-19T01:50:00Z"),
      confirmations: 0,
      disagreements: 4,
      moderated: true,
    },
    {
      value: "CLOSED",
      createdAt: new Date("2026-08-19T00:55:00Z"),
      expiresAt: new Date("2026-08-19T01:55:00Z"),
      confirmations: 3,
      disagreements: 0,
      moderated: true,
    },
  ], now);
  assert.equal(aggregate.value, "CLOSED");
  assert.equal(aggregate.source, "COMMUNITY");
  assert.ok(aggregate.confidence > 0.5 && aggregate.confidence < 1);
});
