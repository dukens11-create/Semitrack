BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Additive metadata only; preserve all prior rows and route/provider data.
ALTER TABLE "Trip" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "truckSnapshotJson" JSONB, ADD COLUMN "dispatchFleetId" TEXT,
 ADD COLUMN "dispatchActorId" TEXT, ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_dispatchFleetId_fkey" FOREIGN KEY ("dispatchFleetId") REFERENCES "OperationalFleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "truckId" TEXT, ADD COLUMN "issuedOn" DATE, ADD COLUMN "expiresOn" DATE,
 ADD COLUMN "verificationState" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Document" ADD CONSTRAINT "Document_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Document_userId_createdAt_idx" ON "Document"("userId", "createdAt");
ALTER TABLE "Document" ADD CONSTRAINT "Document_dates_valid" CHECK ("issuedOn" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "issuedOn");
ALTER TABLE "Document" ADD CONSTRAINT "Document_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_revision_positive" CHECK ("revision" > 0);

COMMIT;
