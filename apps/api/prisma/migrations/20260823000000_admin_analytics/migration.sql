ALTER TABLE "User" ADD COLUMN "lastActivityAt" TIMESTAMP(3);

ALTER TABLE "Trip"
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "actualDistanceMiles" DOUBLE PRECISION,
ADD COLUMN "actualDurationSeconds" INTEGER;

ALTER TABLE "Subscription"
ADD COLUMN "priceAmountCents" INTEGER,
ADD COLUMN "priceCurrency" TEXT,
ADD COLUMN "billingInterval" TEXT;

CREATE TABLE "NavigationSession" (
    "id" TEXT NOT NULL,
    "clientSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "estimatedDriveMinutes" INTEGER,
    "actualDistanceMiles" DOUBLE PRECISION,
    "actualDurationSeconds" INTEGER,
    "stateRegion" TEXT,
    "hosWarningShownAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NavigationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "clientEventId" TEXT,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityId" TEXT,
    "stateRegion" TEXT,
    "numericValue" DOUBLE PRECISION,
    "durationSeconds" INTEGER,
    "metadataJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "processingFeeCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "failureCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionStatusEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "previousStatus" TEXT,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiErrorLog" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NavigationSession_clientSessionId_key" ON "NavigationSession"("clientSessionId");
CREATE INDEX "NavigationSession_status_lastHeartbeatAt_idx" ON "NavigationSession"("status", "lastHeartbeatAt");
CREATE INDEX "NavigationSession_userId_startedAt_idx" ON "NavigationSession"("userId", "startedAt");
CREATE INDEX "NavigationSession_stateRegion_startedAt_idx" ON "NavigationSession"("stateRegion", "startedAt");

CREATE UNIQUE INDEX "AppAnalyticsEvent_clientEventId_key" ON "AppAnalyticsEvent"("clientEventId");
CREATE INDEX "AppAnalyticsEvent_eventType_occurredAt_idx" ON "AppAnalyticsEvent"("eventType", "occurredAt");
CREATE INDEX "AppAnalyticsEvent_userId_occurredAt_idx" ON "AppAnalyticsEvent"("userId", "occurredAt");
CREATE INDEX "AppAnalyticsEvent_stateRegion_occurredAt_idx" ON "AppAnalyticsEvent"("stateRegion", "occurredAt");

CREATE UNIQUE INDEX "PaymentTransaction_providerEventId_key" ON "PaymentTransaction"("providerEventId");
CREATE INDEX "PaymentTransaction_status_occurredAt_idx" ON "PaymentTransaction"("status", "occurredAt");
CREATE INDEX "PaymentTransaction_type_occurredAt_idx" ON "PaymentTransaction"("type", "occurredAt");
CREATE INDEX "PaymentTransaction_userId_occurredAt_idx" ON "PaymentTransaction"("userId", "occurredAt");

CREATE UNIQUE INDEX "SubscriptionStatusEvent_providerEventId_key" ON "SubscriptionStatusEvent"("providerEventId");
CREATE INDEX "SubscriptionStatusEvent_status_occurredAt_idx" ON "SubscriptionStatusEvent"("status", "occurredAt");
CREATE INDEX "SubscriptionStatusEvent_subscriptionId_occurredAt_idx" ON "SubscriptionStatusEvent"("subscriptionId", "occurredAt");

CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");
CREATE INDEX "ApiErrorLog_occurredAt_idx" ON "ApiErrorLog"("occurredAt");
CREATE INDEX "ApiErrorLog_statusCode_occurredAt_idx" ON "ApiErrorLog"("statusCode", "occurredAt");

ALTER TABLE "NavigationSession" ADD CONSTRAINT "NavigationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NavigationSession" ADD CONSTRAINT "NavigationSession_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AppAnalyticsEvent" ADD CONSTRAINT "AppAnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionStatusEvent" ADD CONSTRAINT "SubscriptionStatusEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
