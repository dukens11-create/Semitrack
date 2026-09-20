-- Additive controls. Existing provider prices, subscriptions and receipts are untouched.
CREATE TABLE "SubscriptionPricingConfig" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'current'),
  "prices" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "SubscriptionPricingConfig" ("id", "prices") VALUES ('current',
  '{"monthlyRegular":1999,"monthlyIntro":1499,"annual":19999,"fleet1":1999,"fleet5":1799,"fleet25":1599,"fleet100":1399}'::jsonb);

CREATE TABLE "SubscriptionAccessHold" (
  "subscriptionId" TEXT PRIMARY KEY REFERENCES "Subscription"("id") ON DELETE CASCADE,
  "suspended" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
