import assert from "node:assert/strict";
import test from "node:test";
import { adminAccountUpdateSchema } from "../src/modules/admin/adminAccountValidation.ts";

test("admin account update requires the current password", () => {
  assert.equal(adminAccountUpdateSchema.safeParse({ email: "admin@example.com" }).success, false);
});

test("admin account update requires an actual change", () => {
  assert.equal(adminAccountUpdateSchema.safeParse({ currentPassword: "current" }).success, false);
});

test("admin account update enforces a strong replacement password", () => {
  const result = adminAccountUpdateSchema.safeParse({ currentPassword: "current", newPassword: "too-short" });
  assert.equal(result.success, false);
});

test("admin account update normalizes email", () => {
  const result = adminAccountUpdateSchema.parse({ currentPassword: "current", email: " ADMIN@Example.COM " });
  assert.equal(result.email, "admin@example.com");
});
