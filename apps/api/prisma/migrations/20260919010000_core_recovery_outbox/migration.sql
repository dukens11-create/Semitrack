-- Additive only. Existing ten migrations and account/token tables are unchanged.
CREATE TABLE "RecoveryDeliveryJob" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    CONSTRAINT "RecoveryDeliveryJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecoveryDeliveryJob_availableAt_expiresAt_idx" ON "RecoveryDeliveryJob"("availableAt", "expiresAt");
