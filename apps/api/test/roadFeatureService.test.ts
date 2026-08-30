import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOsmRoadFeatures } from "../src/services/roadFeatureService.ts";

test("normalizes and deduplicates mapped traffic controls", () => {
  const items = normalizeOsmRoadFeatures([
    { type: "node", id: 1, lat: 39.5, lon: -119.8, tags: { highway: "traffic_signals" } },
    { type: "node", id: 2, lat: 39.50001, lon: -119.80001, tags: { highway: "traffic_signals" } },
    { type: "node", id: 3, lat: 39.501, lon: -119.8, tags: { highway: "stop" } },
    { type: "node", id: 4, lat: 39.502, lon: -119.8, tags: { traffic_sign: "US:W1-5" } },
    { type: "node", id: 5, lat: 39.503, lon: -119.8, tags: { railway: "level_crossing" } },
  ], { lat: 39.5, lng: -119.8 }, 5_000);

  assert.equal(items.filter((item) => item.kind === "TRAFFIC_SIGNAL").length, 1);
  assert.equal(items.some((item) => item.kind === "STOP_SIGN"), true);
  assert.equal(items.some((item) => item.kind === "WARNING_SIGN"), true);
  assert.equal(items.some((item) => item.kind === "RAILROAD_CROSSING"), true);
  assert.equal(items.every((item) => item.provider === "OpenStreetMap"), true);
});

test("does not turn unknown nodes into road warnings", () => {
  const items = normalizeOsmRoadFeatures([
    { type: "node", id: 10, lat: 39.5, lon: -119.8, tags: { amenity: "cafe" } },
  ], { lat: 39.5, lng: -119.8 }, 5_000);
  assert.deepEqual(items, []);
});