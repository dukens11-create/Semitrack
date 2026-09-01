-- Additive Phase 2 structures for the approved fleet-seat and refund policies.
-- No Stripe API calls, live credentials, or production billing are enabled by
-- this migration.

CREATE TYPE "FleetBillingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'CLOSED');
CREATE TYPE "FleetMembershipRole" AS ENUM ('OWNER', 'BILLING_ADMIN', 'DRIVER');
CREATE TYPE "FleetSeatChangeType" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "FleetSeatChangeStatus" AS ENUM (
  'REQUESTED', 'AWAITING_PROVIDER', 'APPLIED', 'SCHEDULED', 'REJECTED', 'CANCELED', 'FAILED'
);
CREATE TYPE "BillingRefundStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'REVIEW_REQUIRED', 'RESOLVED');
CREATE TYPE "BillingRefundDisposition" AS ENUM (
  'RETAIN_ACCESS', 'ADMIN_REVIEW_REQUIRED', 'REVOKE_AFTER_VERIFIED_CANCELLATION'
);

ALTER TABLE "Subscription"
  ADD COLUMN "fleetBillingAccountId" TEXT,
  ADD COLUMN "seatQuantity" INTEGER,
  ADD COLUMN "pendingSeatQuantity" INTEGER,
  ADD COLUMN "pendingSeatEffectiveAt" TIMESTAMP(3),
  ADD CONSTRAINT "Subscription_seat_quantities_valid" CHECK (
    ("seatQuantity" IS NULL OR "seatQuantity" >= 0) AND
    ("pendingSeatQuantity" IS NULL OR "pendingSeatQuantity" >= 0)
  );

CREATE TABLE "FleetBillingAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
  "status" "FleetBillingStatus" NOT NULL DEFAULT 'DRAFT',
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "providerPriceId" TEXT,
  "currentSeatQuantity" INTEGER NOT NULL DEFAULT 0,
  "pendingSeatQuantity" INTEGER,
  "pendingSeatEffectiveAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "lastProviderEventAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetBillingAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FleetBillingAccount_seat_quantities_valid" CHECK (
    "currentSeatQuantity" >= 0 AND
    ("pendingSeatQuantity" IS NULL OR "pendingSeatQuantity" >= 0)
  )
);

CREATE UNIQUE INDEX "FleetBillingAccount_provider_providerCustomerId_key"
  ON "FleetBillingAccount"("provider", "providerCustomerId");
CREATE UNIQUE INDEX "FleetBillingAccount_provider_providerSubscriptionId_key"
  ON "FleetBillingAccount"("provider", "providerSubscriptionId");
CREATE INDEX "FleetBillingAccount_status_currentPeriodEnd_idx"
  ON "FleetBillingAccount"("status", "currentPeriodEnd");

CREATE TABLE "FleetMembership" (
  "id" TEXT NOT NULL,
  "fleetBillingAccountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "FleetMembershipRole" NOT NULL DEFAULT 'DRIVER',
  "requiresSeat" BOOLEAN NOT NULL DEFAULT true,
  "seatAssignedAt" TIMESTAMP(3),
  "unassignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetMembership_fleetBillingAccountId_userId_key"
  ON "FleetMembership"("fleetBillingAccountId", "userId");
CREATE INDEX "FleetMembership_userId_unassignedAt_idx"
  ON "FleetMembership"("userId", "unassignedAt");
CREATE INDEX "FleetMembership_fleetBillingAccountId_requiresSeat_unassignedAt_idx"
  ON "FleetMembership"("fleetBillingAccountId", "requiresSeat", "unassignedAt");

CREATE TABLE "FleetSeatChange" (
  "id" TEXT NOT NULL,
  "fleetBillingAccountId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "type" "FleetSeatChangeType" NOT NULL,
  "status" "FleetSeatChangeStatus" NOT NULL DEFAULT 'REQUESTED',
  "previousQuantity" INTEGER NOT NULL,
  "requestedQuantity" INTEGER NOT NULL,
  "requiredAssignedSeats" INTEGER NOT NULL,
  "providerRequestId" TEXT,
  "providerEventId" TEXT,
  "expectedInvoiceAmountCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "prorationBehavior" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "providerAcceptedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetSeatChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FleetSeatChange_quantities_valid" CHECK (
    "previousQuantity" >= 0 AND
    "requestedQuantity" >= 0 AND
    "requiredAssignedSeats" >= 0 AND
    "requestedQuantity" >= "requiredAssignedSeats" AND
    (
      ("type" = 'INCREASE' AND "requestedQuantity" > "previousQuantity") OR
      ("type" = 'DECREASE' AND "requestedQuantity" < "previousQuantity")
    ) AND
    ("expectedInvoiceAmountCents" IS NULL OR "expectedInvoiceAmountCents" >= 0)
  )
);

CREATE UNIQUE INDEX "FleetSeatChange_providerRequestId_key" ON "FleetSeatChange"("providerRequestId");
CREATE UNIQUE INDEX "FleetSeatChange_providerEventId_key" ON "FleetSeatChange"("providerEventId");
CREATE INDEX "FleetSeatChange_fleetBillingAccountId_status_createdAt_idx"
  ON "FleetSeatChange"("fleetBillingAccountId", "status", "createdAt");
CREATE INDEX "FleetSeatChange_requestedByUserId_createdAt_idx"
  ON "FleetSeatChange"("requestedByUserId", "createdAt");

CREATE TABLE "BillingRefund" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "paymentTransactionId" TEXT,
  "provider" "BillingProvider" NOT NULL,
  "providerRefundId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "status" "BillingRefundStatus" NOT NULL DEFAULT 'RECEIVED',
  "disposition" "BillingRefundDisposition" NOT NULL,
  "originalAmountCents" INTEGER NOT NULL,
  "refundAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "reason" TEXT,
  "isFullRefund" BOOLEAN NOT NULL,
  "subscriptionCanceledOrRevoked" BOOLEAN NOT NULL DEFAULT false,
  "administratorReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "administratorAction" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingRefund_amounts_valid" CHECK (
    "originalAmountCents" >= 0 AND
    "refundAmountCents" >= 0 AND
    "refundAmountCents" <= "originalAmountCents" AND
    "isFullRefund" = ("refundAmountCents" = "originalAmountCents")
  )
);

CREATE UNIQUE INDEX "BillingRefund_provider_providerRefundId_key"
  ON "BillingRefund"("provider", "providerRefundId");
CREATE UNIQUE INDEX "BillingRefund_provider_providerEventId_key"
  ON "BillingRefund"("provider", "providerEventId");
CREATE INDEX "BillingRefund_userId_occurredAt_idx" ON "BillingRefund"("userId", "occurredAt");
CREATE INDEX "BillingRefund_subscriptionId_occurredAt_idx"
  ON "BillingRefund"("subscriptionId", "occurredAt");
CREATE INDEX "BillingRefund_status_administratorReviewRequired_occurredAt_idx"
  ON "BillingRefund"("status", "administratorReviewRequired", "occurredAt");

CREATE INDEX "Subscription_fleetBillingAccountId_status_idx"
  ON "Subscription"("fleetBillingAccountId", "status");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_fleetBillingAccountId_fkey"
  FOREIGN KEY ("fleetBillingAccountId") REFERENCES "FleetBillingAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FleetMembership" ADD CONSTRAINT "FleetMembership_fleetBillingAccountId_fkey"
  FOREIGN KEY ("fleetBillingAccountId") REFERENCES "FleetBillingAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FleetMembership" ADD CONSTRAINT "FleetMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FleetSeatChange" ADD CONSTRAINT "FleetSeatChange_fleetBillingAccountId_fkey"
  FOREIGN KEY ("fleetBillingAccountId") REFERENCES "FleetBillingAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FleetSeatChange" ADD CONSTRAINT "FleetSeatChange_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingRefund" ADD CONSTRAINT "BillingRefund_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingRefund" ADD CONSTRAINT "BillingRefund_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingRefund" ADD CONSTRAINT "BillingRefund_paymentTransactionId_fkey"
  FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingRefund" ADD CONSTRAINT "BillingRefund_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
