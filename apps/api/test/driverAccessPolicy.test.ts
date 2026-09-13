import assert from "node:assert/strict";
import test from "node:test";
import { driverRecordScope, canReadDriverRecords, canReadGlobalAnalytics } from "../src/modules/admin/driverAccessPolicy.ts";

test("unknown and non-operational roles never gain driver access", () => {
  for (const role of ["", "DRIVER", "MODERATOR", "SUPER_ADMIN", "OPERATIONS", "DISPATCH", "SAFETY", "SUPPORT", "BILLING", "READ_ONLY", "admin"]) {
    assert.equal(canReadDriverRecords(role), false);
    assert.deepEqual(driverRecordScope({ userId: "staff", role }), { id: { in: [] } });
  }
});
test("super-admin legacy role retains explicitly authorized global access", () => {
  assert.equal(canReadDriverRecords("ADMIN"), true);
  assert.deepEqual(driverRecordScope({ userId: "staff", role: "ADMIN" }), {});
});
test("fleet staff requires the same fleet, active owner and active driver membership", () => {
  assert.equal(canReadDriverRecords("FLEET_ADMIN"), true);
  assert.deepEqual(driverRecordScope({ userId: "owner-1", role: "FLEET_ADMIN" }), {
    role: "DRIVER", fleetMemberships: { some: { unassignedAt: null,
      fleetBillingAccount: { memberships: { some: { userId: "owner-1", role: "OWNER", unassignedAt: null } } },
    } },
  });
  assert.deepEqual(driverRecordScope({ userId: "", role: "FLEET_ADMIN" }), { id: { in: [] } });
});
test("unscoped aggregate analytics deny fleet administrators", () => {
  assert.equal(canReadGlobalAnalytics("ADMIN"), true);
  assert.equal(canReadGlobalAnalytics("MODERATOR"), true);
  for (const role of ["FLEET_ADMIN", "DRIVER", "READ_ONLY", "unknown"]) assert.equal(canReadGlobalAnalytics(role), false);
});
