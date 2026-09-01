-- Phase 2 provider-independent subscription and entitlement foundation.
-- Existing subscription rows are preserved. New billing integrations remain
-- disabled until their provider-specific verification phases are approved.

ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'GRACE_PERIOD';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'BILLING_RETRY';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'CANCEL_AT_PERIOD_END';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'REVOKED';

CREATE TYPE "BillingProvider" AS ENUM ('GOOGLE_PLAY', 'APPLE', 'STRIPE', 'PILOT', 'ADMIN_GRANT');
CREATE TYPE "BillingEnvironment" AS ENUM ('TEST', 'SANDBOX', 'PRODUCTION');
CREATE TYPE "EntitlementCode" AS ENUM ('PREMIUM_NAVIGATION');
CREATE TYPE "EntitlementSourceType" AS ENUM ('SUBSCRIPTION', 'PILOT', 'ADMIN_GRANT', 'FLEET_SEAT');
CREATE TYPE "EntitlementSnapshotStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "SubscriptionOfferKind" AS ENUM ('REGULAR_TRIAL', 'PILOT_DISCOUNT', 'INTRODUCTORY_OFFER', 'PROMOTIONAL_OFFER');
CREATE TYPE "OfferRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'EXPIRED', 'REVOKED');
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "PilotCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "PilotInvitationStatus" AS ENUM ('APPROVED', 'DELIVERED', 'REDEEMED', 'EXPIRED', 'REVOKED');
CREATE TYPE "PilotInvitationEventType" AS ENUM ('APPROVED', 'DELIVERED', 'REDEEMED', 'EXPIRED', 'REVOKED');

DROP INDEX IF EXISTS "Subscription_providerSubscriptionId_key";

ALTER TABLE "Subscription"
  ADD COLUMN "providerOriginalTransactionId" TEXT,
  ADD COLUMN "providerPriceId" TEXT,
  ADD COLUMN "environment" "BillingEnvironment" NOT NULL DEFAULT 'TEST',
  ADD COLUMN "entitlementCode" "EntitlementCode" NOT NULL DEFAULT 'PREMIUM_NAVIGATION',
  ADD COLUMN "sourceType" "EntitlementSourceType" NOT NULL DEFAULT 'SUBSCRIPTION',
  ADD COLUMN "trialStart" TIMESTAMP(3),
  ADD COLUMN "trialEnd" TIMESTAMP(3),
  ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
  ADD COLUMN "gracePeriodEnd" TIMESTAMP(3),
  ADD COLUMN "billingRetryStartedAt" TIMESTAMP(3),
  ADD COLUMN "pilotStart" TIMESTAMP(3),
  ADD COLUMN "pilotEnd" TIMESTAMP(3),
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastProviderEventAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Subscription_provider_providerSubscriptionId_key"
  ON "Subscription"("provider", "providerSubscriptionId");
CREATE INDEX "Subscription_provider_providerOriginalTransactionId_idx"
  ON "Subscription"("provider", "providerOriginalTransactionId");

CREATE TABLE "EntitlementSource" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entitlementCode" "EntitlementCode" NOT NULL DEFAULT 'PREMIUM_NAVIGATION',
  "provider" "BillingProvider" NOT NULL,
  "sourceType" "EntitlementSourceType" NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "status" "SubscriptionStatus" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "accessEndsAt" TIMESTAMP(3),
  "gracePeriodEndsAt" TIMESTAMP(3),
  "lastProviderEventAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntitlementSource_provider_sourceReference_key"
  ON "EntitlementSource"("provider", "sourceReference");
CREATE INDEX "EntitlementSource_userId_entitlementCode_status_idx"
  ON "EntitlementSource"("userId", "entitlementCode", "status");
CREATE INDEX "EntitlementSource_subscriptionId_idx" ON "EntitlementSource"("subscriptionId");
CREATE INDEX "EntitlementSource_accessEndsAt_idx" ON "EntitlementSource"("accessEndsAt");

CREATE TABLE "EntitlementSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entitlementCode" "EntitlementCode" NOT NULL,
  "status" "EntitlementSnapshotStatus" NOT NULL DEFAULT 'INACTIVE',
  "effectiveSourceId" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "cacheValidUntil" TIMESTAMP(3) NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntitlementSnapshot_userId_entitlementCode_key"
  ON "EntitlementSnapshot"("userId", "entitlementCode");
CREATE INDEX "EntitlementSnapshot_status_cacheValidUntil_idx"
  ON "EntitlementSnapshot"("status", "cacheValidUntil");
CREATE INDEX "EntitlementSnapshot_effectiveSourceId_idx"
  ON "EntitlementSnapshot"("effectiveSourceId");

CREATE TABLE "PilotCampaign" (
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" "PilotCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "redemptionLimit" INTEGER NOT NULL DEFAULT 100,
  "reservedCount" INTEGER NOT NULL DEFAULT 0,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "discountMonths" INTEGER NOT NULL DEFAULT 6,
  "monthlyPriceCents" INTEGER NOT NULL DEFAULT 999,
  "regularMonthlyPriceCents" INTEGER NOT NULL DEFAULT 1999,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotCampaign_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "PilotCampaign_limit_valid" CHECK ("redemptionLimit" > 0 AND "redemptionLimit" <= 100),
  CONSTRAINT "PilotCampaign_counts_valid" CHECK (
    "reservedCount" >= 0 AND "redeemedCount" >= 0 AND
    "reservedCount" + "redeemedCount" <= "redemptionLimit"
  ),
  CONSTRAINT "PilotCampaign_prices_valid" CHECK (
    "monthlyPriceCents" >= 0 AND "regularMonthlyPriceCents" >= 0 AND "discountMonths" > 0
  )
);

CREATE TABLE "PilotInvitation" (
  "id" TEXT NOT NULL,
  "campaignCode" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "status" "PilotInvitationStatus" NOT NULL DEFAULT 'APPROVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredByUserId" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "redeemedByUserId" TEXT,
  "redeemedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PilotInvitation_tokenHash_key" ON "PilotInvitation"("tokenHash");
CREATE INDEX "PilotInvitation_campaignCode_status_expiresAt_idx"
  ON "PilotInvitation"("campaignCode", "status", "expiresAt");
CREATE INDEX "PilotInvitation_email_status_idx" ON "PilotInvitation"("email", "status");
CREATE INDEX "PilotInvitation_userId_status_idx" ON "PilotInvitation"("userId", "status");

CREATE TABLE "SubscriptionOfferRedemption" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eligibilityGroup" TEXT NOT NULL DEFAULT 'WELCOME_OFFER',
  "offerKind" "SubscriptionOfferKind" NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "status" "OfferRedemptionStatus" NOT NULL,
  "invitationId" TEXT,
  "subscriptionId" TEXT,
  "externalOfferId" TEXT,
  "reservedAt" TIMESTAMP(3),
  "redeemedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionOfferRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionOfferRedemption_invitationId_key"
  ON "SubscriptionOfferRedemption"("invitationId");
CREATE UNIQUE INDEX "SubscriptionOfferRedemption_userId_eligibilityGroup_key"
  ON "SubscriptionOfferRedemption"("userId", "eligibilityGroup");
CREATE INDEX "SubscriptionOfferRedemption_status_expiresAt_idx"
  ON "SubscriptionOfferRedemption"("status", "expiresAt");
CREATE INDEX "SubscriptionOfferRedemption_subscriptionId_idx"
  ON "SubscriptionOfferRedemption"("subscriptionId");

CREATE TABLE "PilotInvitationEvent" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "type" "PilotInvitationEventType" NOT NULL,
  "actorUserId" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PilotInvitationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PilotInvitationEvent_invitationId_createdAt_idx"
  ON "PilotInvitationEvent"("invitationId", "createdAt");
CREATE INDEX "PilotInvitationEvent_type_createdAt_idx"
  ON "PilotInvitationEvent"("type", "createdAt");

CREATE TABLE "ProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payloadHash" TEXT NOT NULL,
  "externalObjectId" TEXT,
  "eventCreatedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderEvent_attempt_count_valid" CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "ProviderEvent_provider_providerEventId_key"
  ON "ProviderEvent"("provider", "providerEventId");
CREATE INDEX "ProviderEvent_status_receivedAt_idx" ON "ProviderEvent"("status", "receivedAt");
CREATE INDEX "ProviderEvent_provider_externalObjectId_eventCreatedAt_idx"
  ON "ProviderEvent"("provider", "externalObjectId", "eventCreatedAt");

CREATE TABLE "BillingAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "provider" "BillingProvider",
  "providerEventId" TEXT,
  "metadataJson" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingAuditLog_createdAt_idx" ON "BillingAuditLog"("createdAt");
CREATE INDEX "BillingAuditLog_actorUserId_createdAt_idx"
  ON "BillingAuditLog"("actorUserId", "createdAt");
CREATE INDEX "BillingAuditLog_targetType_targetId_idx"
  ON "BillingAuditLog"("targetType", "targetId");
CREATE INDEX "BillingAuditLog_provider_providerEventId_idx"
  ON "BillingAuditLog"("provider", "providerEventId");

ALTER TABLE "EntitlementSource" ADD CONSTRAINT "EntitlementSource_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementSource" ADD CONSTRAINT "EntitlementSource_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntitlementSnapshot" ADD CONSTRAINT "EntitlementSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementSnapshot" ADD CONSTRAINT "EntitlementSnapshot_effectiveSourceId_fkey"
  FOREIGN KEY ("effectiveSourceId") REFERENCES "EntitlementSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_campaignCode_fkey"
  FOREIGN KEY ("campaignCode") REFERENCES "PilotCampaign"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_deliveredByUserId_fkey"
  FOREIGN KEY ("deliveredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_redeemedByUserId_fkey"
  FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotInvitation" ADD CONSTRAINT "PilotInvitation_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOfferRedemption" ADD CONSTRAINT "SubscriptionOfferRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOfferRedemption" ADD CONSTRAINT "SubscriptionOfferRedemption_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "PilotInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOfferRedemption" ADD CONSTRAINT "SubscriptionOfferRedemption_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotInvitationEvent" ADD CONSTRAINT "PilotInvitationEvent_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "PilotInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotInvitationEvent" ADD CONSTRAINT "PilotInvitationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAuditLog" ADD CONSTRAINT "BillingAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PilotCampaign"
  ("code", "displayName", "status", "redemptionLimit", "reservedCount", "redeemedCount",
   "discountMonths", "monthlyPriceCents", "regularMonthlyPriceCents", "createdAt", "updatedAt")
VALUES
  ('FOUNDING_100', 'Semi-Trax Founding 100 Pilot', 'ACTIVE', 100, 0, 0, 6, 999, 1999, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

UPDATE "SubscriptionPlanCatalog" SET
  "displayName" = 'Semi-Trax Monthly',
  "purpose" = 'Regular individual driver monthly plan',
  "description" = 'Monthly premium navigation subscription; localized store pricing is authoritative at checkout.',
  "priceAmountCents" = 1999,
  "currency" = 'USD',
  "billingInterval" = 'MONTH',
  "trialDays" = 7,
  "isActive" = true,
  "isPublic" = true,
  "isFeatured" = false,
  "badge" = NULL,
  "sortOrder" = 20,
  "version" = "version" + 1,
  "updatedAt" = NOW()
WHERE "code" = 'MONTHLY';

UPDATE "SubscriptionPlanCatalog" SET
  "displayName" = 'Semi-Trax Annual',
  "purpose" = 'Regular individual driver annual plan',
  "description" = 'Annual premium navigation subscription; localized store pricing is authoritative at checkout.',
  "priceAmountCents" = 19999,
  "currency" = 'USD',
  "billingInterval" = 'YEAR',
  "trialDays" = 7,
  "isActive" = true,
  "isPublic" = true,
  "isFeatured" = true,
  "badge" = 'BEST VALUE',
  "sortOrder" = 30,
  "version" = "version" + 1,
  "updatedAt" = NOW()
WHERE "code" = 'ANNUAL';

INSERT INTO "SubscriptionPlanCatalog"
  ("code", "displayName", "purpose", "description", "priceAmountCents", "currency", "billingInterval",
   "trialDays", "isActive", "isPublic", "isFeatured", "badge", "sortOrder", "version")
VALUES
  ('PILOT_MONTHLY', 'Founding 100 Pilot', 'Administrator-approved six-month pilot',
   'Not public. Eligibility is controlled by a single-use backend invitation and verified provider billing.',
   999, 'USD', 'MONTH', 0, false, false, false, 'APPROVAL REQUIRED', 40, 1),
  ('FLEET_1_4', 'Fleet 1–4 Drivers', 'Direct fleet billing tier',
   'Website/Stripe fleet tier. Provider billing remains disabled during Phase 2.',
   1999, 'USD', 'MONTH', 0, false, false, false, NULL, 50, 1),
  ('FLEET_5_24', 'Fleet 5–24 Drivers', 'Direct fleet billing tier',
   'Website/Stripe fleet tier. Provider billing remains disabled during Phase 2.',
   1799, 'USD', 'MONTH', 0, false, false, false, NULL, 60, 1),
  ('FLEET_25_99', 'Fleet 25–99 Drivers', 'Direct fleet billing tier',
   'Website/Stripe fleet tier. Provider billing remains disabled during Phase 2.',
   1599, 'USD', 'MONTH', 0, false, false, false, NULL, 70, 1),
  ('FLEET_100_PLUS', 'Fleet 100+ Drivers', 'Sales-assisted custom fleet contract',
   'Contact Semi-Trax at contact@semitrax.com. No self-service price is configured.',
   NULL, 'USD', 'CUSTOM', 0, false, false, false, 'CONTACT SEMI-TRAX', 80, 1)
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "purpose" = EXCLUDED."purpose",
  "description" = EXCLUDED."description",
  "priceAmountCents" = EXCLUDED."priceAmountCents",
  "currency" = EXCLUDED."currency",
  "billingInterval" = EXCLUDED."billingInterval",
  "trialDays" = EXCLUDED."trialDays",
  "isActive" = EXCLUDED."isActive",
  "isPublic" = EXCLUDED."isPublic",
  "isFeatured" = EXCLUDED."isFeatured",
  "badge" = EXCLUDED."badge",
  "sortOrder" = EXCLUDED."sortOrder",
  "version" = "SubscriptionPlanCatalog"."version" + 1,
  "updatedAt" = NOW();
