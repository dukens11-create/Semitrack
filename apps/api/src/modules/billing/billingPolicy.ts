export const entitlementGrantingStatuses = [
  "TRIALING",
  "ACTIVE",
  "GRACE_PERIOD",
  "BILLING_RETRY",
  "CANCEL_AT_PERIOD_END",
] as const;

export type EntitlementGrantingStatus = (typeof entitlementGrantingStatuses)[number];

export type EntitlementSourceCandidate = {
  id: string;
  status: string;
  startsAt: Date;
  accessEndsAt: Date | null;
  gracePeriodEndsAt?: Date | null;
};

const grantingStatusSet = new Set<string>(entitlementGrantingStatuses);

export function isAccessGrantingStatus(status: string): status is EntitlementGrantingStatus {
  return grantingStatusSet.has(status);
}

export function entitlementSourceEnd(candidate: EntitlementSourceCandidate): Date | null {
  if (
    (candidate.status === "GRACE_PERIOD" || candidate.status === "BILLING_RETRY") &&
    candidate.gracePeriodEndsAt
  ) {
    if (!candidate.accessEndsAt || candidate.gracePeriodEndsAt > candidate.accessEndsAt) {
      return candidate.gracePeriodEndsAt;
    }
  }
  return candidate.accessEndsAt;
}

export function isEntitlementSourceActive(candidate: EntitlementSourceCandidate, now = new Date()): boolean {
  if (!isAccessGrantingStatus(candidate.status) || candidate.startsAt > now) return false;
  const end = entitlementSourceEnd(candidate);
  return end === null || end > now;
}

export function selectEffectiveEntitlementSource<T extends EntitlementSourceCandidate>(
  candidates: readonly T[],
  now = new Date(),
): T | null {
  const active = candidates.filter((candidate) => isEntitlementSourceActive(candidate, now));
  active.sort((left, right) => {
    const leftEnd = entitlementSourceEnd(left)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightEnd = entitlementSourceEnd(right)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
    if (left.startsAt.getTime() !== right.startsAt.getTime()) {
      return right.startsAt.getTime() - left.startsAt.getTime();
    }
    return left.id.localeCompare(right.id);
  });
  return active[0] ?? null;
}

export function entitlementCacheDeadline(
  now: Date,
  effectiveUntil: Date | null,
  activeCacheHours: number,
  inactiveCacheMinutes: number,
): Date {
  const configured = new Date(
    now.getTime() + (effectiveUntil ? activeCacheHours * 3_600_000 : inactiveCacheMinutes * 60_000),
  );
  return effectiveUntil && effectiveUntil < configured ? effectiveUntil : configured;
}

export function pilotCapacityAvailable(input: {
  redemptionLimit: number;
  reservedCount: number;
  redeemedCount: number;
}): number {
  return Math.max(0, input.redemptionLimit - input.reservedCount - input.redeemedCount);
}

export function shouldApplyProviderEvent(lastAppliedAt: Date | null, incomingEventAt: Date | null): boolean {
  if (!incomingEventAt || !lastAppliedAt) return true;
  return incomingEventAt > lastAppliedAt;
}

export function hasPilotTrialConflict(input: {
  offerKind?: string | null;
  sourceType?: string | null;
  catalogPlanCode?: string | null;
  status: string;
  trialStart?: Date | null;
  trialEnd?: Date | null;
}) {
  const isPilot = input.offerKind === "PILOT_DISCOUNT"
    || input.sourceType === "PILOT"
    || input.catalogPlanCode === "PILOT_MONTHLY";
  return isPilot && (input.status === "TRIALING" || Boolean(input.trialStart) || Boolean(input.trialEnd));
}

export function stripeGracePeriodEnd(failedAt: Date, gracePeriodDays: number) {
  if (!Number.isSafeInteger(gracePeriodDays) || gracePeriodDays < 0) {
    throw new Error("Stripe grace-period days must be a non-negative integer");
  }
  return new Date(failedAt.getTime() + gracePeriodDays * 86_400_000);
}

export type FleetPricingTier = {
  code: "FLEET_1_4" | "FLEET_5_24" | "FLEET_25_99" | "FLEET_100_PLUS";
  unitPriceCents: number | null;
  requiresSalesContact: boolean;
};

export function fleetPricingTier(seatQuantity: number): FleetPricingTier {
  if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 1) {
    throw new Error("Fleet seat quantity must be a positive integer");
  }
  if (seatQuantity <= 4) return { code: "FLEET_1_4", unitPriceCents: 1999, requiresSalesContact: false };
  if (seatQuantity <= 24) return { code: "FLEET_5_24", unitPriceCents: 1799, requiresSalesContact: false };
  if (seatQuantity <= 99) return { code: "FLEET_25_99", unitPriceCents: 1599, requiresSalesContact: false };
  return { code: "FLEET_100_PLUS", unitPriceCents: null, requiresSalesContact: true };
}

export function planFleetSeatChange(input: {
  currentQuantity: number;
  requestedQuantity: number;
  requiredAssignedSeats: number;
  currentPeriodEnd: Date | null;
}) {
  for (const [name, value] of [
    ["currentQuantity", input.currentQuantity],
    ["requestedQuantity", input.requestedQuantity],
    ["requiredAssignedSeats", input.requiredAssignedSeats],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  if (input.requestedQuantity < input.requiredAssignedSeats) {
    throw new Error("Drivers requiring seats must be unassigned before reducing below the assigned-seat count");
  }
  if (input.requestedQuantity === input.currentQuantity) {
    throw new Error("Requested fleet seat quantity must change");
  }

  const pricing = fleetPricingTier(input.requestedQuantity);
  if (input.requestedQuantity > input.currentQuantity) {
    return {
      type: "INCREASE" as const,
      initialStatus: "AWAITING_PROVIDER" as const,
      effectiveAt: null,
      prorationBehavior: "create_prorations" as const,
      grantBeforeProviderAcceptance: false,
      retainCurrentSeatsUntilEffectiveAt: false,
      pricing,
    };
  }
  if (!input.currentPeriodEnd) throw new Error("A current billing-period end is required for a seat decrease");
  return {
    type: "DECREASE" as const,
    initialStatus: "SCHEDULED" as const,
    effectiveAt: input.currentPeriodEnd,
    prorationBehavior: "none" as const,
    grantBeforeProviderAcceptance: false,
    retainCurrentSeatsUntilEffectiveAt: true,
    pricing,
  };
}

export function classifyVerifiedRefund(input: {
  refundAmountCents: number;
  originalAmountCents: number;
  subscriptionCanceledOrRevoked: boolean;
}) {
  if (
    !Number.isSafeInteger(input.originalAmountCents)
    || !Number.isSafeInteger(input.refundAmountCents)
    || input.originalAmountCents < 0
    || input.refundAmountCents < 0
    || input.refundAmountCents > input.originalAmountCents
  ) {
    throw new Error("Refund amounts must be valid non-negative integer cents");
  }
  const isFullRefund = input.refundAmountCents === input.originalAmountCents;
  if (!isFullRefund) {
    return {
      isFullRefund,
      disposition: "RETAIN_ACCESS" as const,
      administratorReviewRequired: false,
      revokeEntitlement: false,
    };
  }
  if (input.subscriptionCanceledOrRevoked) {
    return {
      isFullRefund,
      disposition: "REVOKE_AFTER_VERIFIED_CANCELLATION" as const,
      administratorReviewRequired: false,
      revokeEntitlement: true,
    };
  }
  return {
    isFullRefund,
    disposition: "ADMIN_REVIEW_REQUIRED" as const,
    administratorReviewRequired: true,
    revokeEntitlement: false,
  };
}
