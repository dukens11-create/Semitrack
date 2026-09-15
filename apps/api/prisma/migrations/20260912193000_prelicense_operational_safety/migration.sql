-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'DISPATCH', 'SAFETY', 'SUPPORT', 'BILLING', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "TruckVerificationState" AS ENUM ('DRIVER_VERIFICATION_REQUIRED', 'ADMIN_UPDATED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('TRACTOR', 'TRAILER');

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "verificationState" "TruckVerificationState" NOT NULL DEFAULT 'DRIVER_VERIFICATION_REQUIRED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT,
ADD COLUMN     "verifiedRevision" INTEGER;

-- AlterTable
ALTER TABLE "EldConnection" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "EldOAuthState" ADD COLUMN     "connectionRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StaffAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "globalScope" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalFleet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalFleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffFleetAccess" (
    "staffAccessId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,

    CONSTRAINT "StaffFleetAccess_pkey" PRIMARY KEY ("staffAccessId","fleetId")
);

-- CreateTable
CREATE TABLE "OperationalFleetDriver" (
    "fleetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalFleetDriver_pkey" PRIMARY KEY ("fleetId","userId")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "kind" "EquipmentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "assignedDriverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccess_userId_key" ON "StaffAccess"("userId");

-- CreateIndex
CREATE INDEX "OperationalFleetDriver_userId_active_idx" ON "OperationalFleetDriver"("userId", "active");

-- CreateIndex
CREATE INDEX "Equipment_assignedDriverId_active_idx" ON "Equipment"("assignedDriverId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_fleetId_kind_unitNumber_key" ON "Equipment"("fleetId", "kind", "unitNumber");

-- AddForeignKey
ALTER TABLE "StaffAccess" ADD CONSTRAINT "StaffAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffFleetAccess" ADD CONSTRAINT "StaffFleetAccess_staffAccessId_fkey" FOREIGN KEY ("staffAccessId") REFERENCES "StaffAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffFleetAccess" ADD CONSTRAINT "StaffFleetAccess_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "OperationalFleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalFleetDriver" ADD CONSTRAINT "OperationalFleetDriver_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "OperationalFleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalFleetDriver" ADD CONSTRAINT "OperationalFleetDriver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "OperationalFleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing defaults remain unverified until the owner explicitly reviews the measured vehicle.
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_positive_revision" CHECK ("revision" > 0);
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_verification_consistent" CHECK (
 ("verificationState" = 'VERIFIED' AND "verifiedRevision" IS NOT NULL AND "verifiedRevision" = "revision" AND "verifiedByUserId" IS NOT NULL AND "verifiedByUserId" = "userId" AND "verifiedAt" IS NOT NULL)
 OR ("verificationState" <> 'VERIFIED' AND "verifiedRevision" IS NULL AND "verifiedByUserId" IS NULL AND "verifiedAt" IS NULL)
);
