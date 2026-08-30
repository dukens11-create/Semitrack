import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEldSnapshot } from "../src/services/eldNormalization.ts";

test("normalizes only provider-supplied ELD fields", () => {
  const result = normalizeEldSnapshot("SAMSARA", {
    drivers: { data: [{ id: "d1", name: "Driver One" }] },
    vehicles: { data: [{ id: "v1", name: "Truck 12", vin: "VIN" }] },
    hos: { data: [{ driverId: "d1", clocks: { drive: { driveRemainingDurationMs: 3_600_000 } }, currentDutyStatus: "driving" }] },
  });
  assert.deepEqual(result.drivers[0], { providerDriverId: "d1", name: "Driver One" });
  assert.equal(result.hos[0]?.remainingDriveSeconds, 3600);
  assert.equal("remainingOnDutySeconds" in (result.hos[0] ?? {}), false);
});
