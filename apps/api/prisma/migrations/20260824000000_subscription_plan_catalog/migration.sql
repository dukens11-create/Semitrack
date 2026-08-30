CREATE TABLE "SubscriptionPlanCatalog" (
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "description" TEXT,
    "priceAmountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billingInterval" TEXT NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionPlanCatalog_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "SubscriptionPlanCatalog_price_nonnegative" CHECK ("priceAmountCents" IS NULL OR "priceAmountCents" >= 0),
    CONSTRAINT "SubscriptionPlanCatalog_trial_days_valid" CHECK ("trialDays" >= 0 AND "trialDays" <= 365),
    CONSTRAINT "SubscriptionPlanCatalog_currency_valid" CHECK (char_length("currency") = 3),
    CONSTRAINT "SubscriptionPlanCatalog_version_valid" CHECK ("version" > 0)
);

ALTER TABLE "Subscription" ADD COLUMN "catalogPlanCode" TEXT;
CREATE INDEX "Subscription_catalogPlanCode_idx" ON "Subscription"("catalogPlanCode");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_catalogPlanCode_fkey"
  FOREIGN KEY ("catalogPlanCode") REFERENCES "SubscriptionPlanCatalog"("code")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SubscriptionPlanCatalog"
  ("code", "displayName", "purpose", "description", "priceAmountCents", "currency", "billingInterval", "trialDays", "isActive", "isPublic", "isFeatured", "badge", "sortOrder", "version")
VALUES
  ('TRIAL', '7-Day Trial', 'Let drivers test SemiTraX', 'Full Premium access for a limited evaluation period.', 0, 'USD', 'TRIAL', 7, true, true, false, NULL, 10, 1),
  ('MONTHLY', 'SemiTraX Monthly', 'Main individual driver plan', 'Billed monthly with no long-term contract.', 999, 'USD', 'MONTH', 0, true, true, true, 'BEST VALUE', 20, 1),
  ('ANNUAL', 'SemiTraX Annual', 'About two months free', 'Billed yearly for drivers who want the best annual value.', 9999, 'USD', 'YEAR', 0, true, true, false, 'SAVE MORE', 30, 1),
  ('FLEET', 'SemiTraX Fleet', 'Pricing per driver or truck', 'Fleet controls and volume pricing will be offered separately.', NULL, 'USD', 'CUSTOM', 0, false, true, false, 'COMING LATER', 40, 1)
ON CONFLICT ("code") DO NOTHING;
