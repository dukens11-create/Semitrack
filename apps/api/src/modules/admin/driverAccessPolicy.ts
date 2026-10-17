import type { Prisma } from "@prisma/client";

export type StaffActor = { userId: string; role: string };
// Existing persisted roles only. Future staff roles require a reviewed migration.
export function canReadDriverRecords(role: string): boolean {
  return role === "ADMIN" || role === "FLEET_ADMIN";
}
export const globalAnalyticsRoles = ["ADMIN", "MODERATOR"];
export function canReadGlobalAnalytics(role: string): boolean {
  return globalAnalyticsRoles.includes(role);
}
export function driverRecordScope(actor: StaffActor): Prisma.UserWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role !== "FLEET_ADMIN" || !actor.userId) return { id: { in: [] } };
  // A global FLEET_ADMIN role alone grants no access to another driver's data.
  // Billing-only membership is not operational authority. Require active OWNER.
  return {
    role: "DRIVER",
    fleetMemberships: { some: {
      unassignedAt: null,
      fleetBillingAccount: { memberships: { some: {
        userId: actor.userId, role: "OWNER", unassignedAt: null,
      } } },
    } },
  };
}
