import assert from "node:assert/strict";
import test from "node:test";

import { hereDepartureTime } from "../src/services/providers/hereTime.ts";
import {
  feetToHereCentimeters,
  poundsToHereKilograms,
} from "../src/services/providers/hereVehicleUnits.ts";

test("HERE truck routes use a current ISO departure timestamp", async () => {
  const fixedDate = new Date("2026-08-20T18:48:00.123Z");
  assert.equal(hereDepartureTime(fixedDate), "2026-08-20T18:48:00.123Z");
  assert.notEqual(hereDepartureTime(fixedDate), "now");

  const startedAt = Date.now();
  const departureTime = hereDepartureTime();
  const parsedDepartureTime = Date.parse(departureTime);
  assert.ok(Number.isFinite(parsedDepartureTime), "departureTime is not ISO-8601");
  assert.ok(parsedDepartureTime >= startedAt - 1000);
  assert.ok(parsedDepartureTime <= Date.now() + 1000);
});

test("HERE truck dimensions use whole centimeters", () => {
  assert.equal(feetToHereCentimeters(13.5), "411");
  assert.equal(feetToHereCentimeters(8.5), "259");
  assert.equal(feetToHereCentimeters(72), "2195");
});

test("HERE truck weights use whole kilograms", () => {
  assert.equal(poundsToHereKilograms(80_000), "36287");
  assert.equal(poundsToHereKilograms(20_000), "9072");
});
