-- Preserve access from any subscription rows created before the unified
-- entitlement foundation. Unknown legacy provider labels are deliberately
-- skipped for manual review instead of being assigned to the wrong provider.
INSERT INTO "EntitlementSource" (
  "id", "userId", "entitlementCode", "provider", "sourceType", "sourceReference",
  "subscriptionId", "status", "startsAt", "accessEndsAt", "gracePeriodEndsAt",
  "lastProviderEventAt", "lastVerifiedAt", "revokedAt", "metadataJson", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(random()::text || clock_timestamp()::text || subscription."id"),
  subscription."userId",
  subscription."entitlementCode",
  CASE UPPER(REPLACE(subscription."provider", '-', '_'))
    WHEN 'GOOGLE_PLAY' THEN 'GOOGLE_PLAY'::"BillingProvider"
    WHEN 'APPLE' THEN 'APPLE'::"BillingProvider"
    WHEN 'STRIPE' THEN 'STRIPE'::"BillingProvider"
    WHEN 'PILOT' THEN 'PILOT'::"BillingProvider"
    WHEN 'ADMIN_GRANT' THEN 'ADMIN_GRANT'::"BillingProvider"
  END,
  subscription."sourceType",
  COALESCE(subscription."providerSubscriptionId", 'legacy-subscription:' || subscription."id"),
  subscription."id",
  subscription."status",
  COALESCE(subscription."trialStart", subscription."currentPeriodStart", subscription."createdAt"),
  CASE
    WHEN subscription."status" IN ('GRACE_PERIOD', 'BILLING_RETRY')
      AND subscription."gracePeriodEnd" IS NOT NULL
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."gracePeriodEnd" > subscription."currentPeriodEnd")
      THEN subscription."gracePeriodEnd"
    ELSE subscription."currentPeriodEnd"
  END,
  subscription."gracePeriodEnd",
  subscription."lastProviderEventAt",
  subscription."verifiedAt",
  CASE WHEN subscription."status" IN ('REFUNDED', 'REVOKED')
    THEN COALESCE(subscription."canceledAt", subscription."updatedAt") ELSE NULL END,
  jsonb_build_object('backfilledFromLegacySubscription', true),
  NOW(),
  NOW()
FROM "Subscription" AS subscription
WHERE UPPER(REPLACE(subscription."provider", '-', '_')) IN
  ('GOOGLE_PLAY', 'APPLE', 'STRIPE', 'PILOT', 'ADMIN_GRANT')
ON CONFLICT ("provider", "sourceReference") DO NOTHING;
