ALTER TABLE "Document" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "DocumentAttachment" (
 "id" TEXT PRIMARY KEY,"documentId" TEXT NOT NULL REFERENCES "Document"(id) ON DELETE RESTRICT,
 "operationId" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"storageKey" TEXT NOT NULL UNIQUE,
 "originalFilename" TEXT NOT NULL,"mimeType" TEXT NOT NULL,"sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes">0),
 "checksum" TEXT NOT NULL,"pageOrder" INTEGER NOT NULL CHECK ("pageOrder">=0),"status" TEXT NOT NULL DEFAULT 'PENDING',
 "replaceId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completedAt" TIMESTAMP(3),
 UNIQUE("documentId","operationId")
);
CREATE INDEX "DocumentAttachment_documentId_status_idx" ON "DocumentAttachment"("documentId","status");
CREATE TABLE "DocumentObjectCleanup" (
 "storageKey" TEXT PRIMARY KEY,"notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"retentionHold" BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "DocumentShare" (
 "id" TEXT PRIMARY KEY,"documentId" TEXT NOT NULL REFERENCES "Document"(id) ON DELETE RESTRICT,
 "sharedByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,"operationId" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,"recipientType" TEXT NOT NULL,"recipientValue" TEXT,"deliveryProvider" TEXT NOT NULL,
 "deliveryStatus" TEXT NOT NULL,"providerMessageId" TEXT,"failureReason" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deliveredAt" TIMESTAMP(3),"failedAt" TIMESTAMP(3),UNIQUE("documentId","operationId")
);
