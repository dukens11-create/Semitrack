CREATE TYPE "RestrictionType" AS ENUM ('HEIGHT', 'GROSS_WEIGHT', 'AXLE_WEIGHT', 'WIDTH', 'LENGTH', 'TRUCK_PROHIBITED', 'HAZMAT', 'TUNNEL', 'SEASONAL', 'RESTRICTED_BRIDGE', 'RESTRICTED_LOCAL_ROAD', 'ROAD_CLOSURE', 'CONSTRUCTION', 'CRITICAL_NOTICE');
CREATE TYPE "WeighStationType" AS ENUM ('FIXED_WEIGH_STATION', 'PORT_OF_ENTRY', 'COMMERCIAL_VEHICLE_ENFORCEMENT', 'INSPECTION_STATION', 'ENFORCEMENT_WIM', 'VIRTUAL_WEIGH_STATION', 'OTHER_ENFORCEMENT');
CREATE TYPE "WeighStationStatus" AS ENUM ('OPEN', 'CLOSED', 'INSPECTION', 'UNKNOWN');
CREATE TYPE "CommunityDataType" AS ENUM ('WEIGH_STATION_STATUS', 'PARKING_AVAILABILITY', 'DIESEL_PRICE', 'RESTRICTION_CORRECTION', 'ROAD_CONDITION');
CREATE TYPE "CommunityVoteValue" AS ENUM ('CONFIRM', 'DISAGREE');
CREATE TYPE "ParkingAvailability" AS ENUM ('PLENTY', 'SOME', 'ALMOST_FULL', 'FULL', 'UNKNOWN');
CREATE TYPE "FuelType" AS ENUM ('DIESEL');
CREATE TYPE "RoadEventType" AS ENUM ('ROAD_CLOSURE', 'CONSTRUCTION', 'INCIDENT', 'CRASH', 'WEATHER', 'SNOW', 'ICE', 'CHAIN_RESTRICTION', 'HIGH_WIND', 'FLOOD', 'TRUCK_RESTRICTION', 'CAMERA', 'MOUNTAIN_PASS', 'OTHER');
CREATE TYPE "EventSeverity" AS ENUM ('INFO', 'MINOR', 'MODERATE', 'SEVERE', 'CRITICAL');
CREATE TYPE "ProviderSyncStatus" AS ENUM ('NEVER_SYNCED', 'HEALTHY', 'DEGRADED', 'ERROR', 'DISABLED');

ALTER TABLE "User" ADD COLUMN "reportTrustScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

CREATE TABLE "TruckRestriction" (
  "id" TEXT NOT NULL, "restrictionType" "RestrictionType" NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "roadName" TEXT, "direction" TEXT, "heightLimitFt" DOUBLE PRECISION,
  "grossWeightLimitLbs" INTEGER, "axleWeightLimitLbs" INTEGER,
  "widthLimitFt" DOUBLE PRECISION, "lengthLimitFt" DOUBLE PRECISION,
  "hazmatTypes" TEXT[] NOT NULL, "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
  "source" TEXT NOT NULL, "sourceId" TEXT, "sourceUrl" TEXT,
  "authoritative" BOOLEAN NOT NULL DEFAULT false, "verified" BOOLEAN NOT NULL DEFAULT false,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true,
  "lastUpdated" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "TruckRestriction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeighStation" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "state" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "highway" TEXT, "direction" TEXT, "mileMarker" DOUBLE PRECISION,
  "type" "WeighStationType" NOT NULL, "officialStatus" "WeighStationStatus" NOT NULL DEFAULT 'UNKNOWN',
  "officialStatusSource" TEXT, "officialSourceName" TEXT NOT NULL, "officialSourceUrl" TEXT NOT NULL,
  "isOfficial" BOOLEAN NOT NULL DEFAULT true, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastOfficialVerification" TIMESTAMP(3), "lastStatusUpdate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeighStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParkingLocation" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL, "state" TEXT, "highway" TEXT, "direction" TEXT,
  "totalTruckSpaces" INTEGER, "reservedSpaces" INTEGER, "paid" BOOLEAN, "amenities" TEXT[] NOT NULL,
  "provider" TEXT NOT NULL, "providerId" TEXT, "providerAvailability" "ParkingAvailability" NOT NULL DEFAULT 'UNKNOWN',
  "providerUpdatedAt" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParkingLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FuelStation" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL, "state" TEXT, "highway" TEXT, "direction" TEXT,
  "provider" TEXT NOT NULL, "providerId" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FuelStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FuelPriceObservation" (
  "id" TEXT NOT NULL, "stationId" TEXT NOT NULL, "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
  "cashPrice" DECIMAL(8,3), "creditPrice" DECIMAL(8,3), "discountPrice" DECIMAL(8,3),
  "currency" TEXT NOT NULL DEFAULT 'USD', "source" TEXT NOT NULL, "sourceId" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0, "verified" BOOLEAN NOT NULL DEFAULT false,
  "observedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelPriceObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityDataReport" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" "CommunityDataType" NOT NULL,
  "entityId" TEXT NOT NULL, "value" TEXT NOT NULL, "numericValue" DECIMAL(10,3),
  "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION, "note" TEXT,
  "sourceContextJson" JSONB, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING', "moderationReason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CommunityDataReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityDataVote" (
  "id" TEXT NOT NULL, "reportId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "value" "CommunityVoteValue" NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CommunityDataVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DotRoadEvent" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "providerEventId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "description" TEXT, "type" "RoadEventType" NOT NULL,
  "severity" "EventSeverity" NOT NULL DEFAULT 'INFO', "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL, "affectedRoad" TEXT, "direction" TEXT,
  "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "lastUpdated" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "geometryJson" JSONB, "sourceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DotRoadEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrafficCamera" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "providerCameraId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "roadway" TEXT, "direction" TEXT, "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL, "imageUrl" TEXT, "streamUrl" TEXT,
  "lastUpdated" TIMESTAMP(3) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrafficCamera_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderSyncState" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL, "dataType" TEXT NOT NULL,
  "status" "ProviderSyncStatus" NOT NULL DEFAULT 'NEVER_SYNCED', "endpointUrl" TEXT,
  "refreshIntervalSec" INTEGER NOT NULL DEFAULT 300, "lastAttemptAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT, "lastErrorMessage" TEXT, "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TruckRestriction_source_sourceId_key" ON "TruckRestriction"("source", "sourceId");
CREATE INDEX "TruckRestriction_active_restrictionType_idx" ON "TruckRestriction"("active", "restrictionType");
CREATE INDEX "TruckRestriction_latitude_longitude_idx" ON "TruckRestriction"("latitude", "longitude");
CREATE INDEX "TruckRestriction_endsAt_idx" ON "TruckRestriction"("endsAt");
CREATE INDEX "WeighStation_state_isActive_idx" ON "WeighStation"("state", "isActive");
CREATE INDEX "WeighStation_latitude_longitude_idx" ON "WeighStation"("latitude", "longitude");
CREATE INDEX "WeighStation_highway_direction_idx" ON "WeighStation"("highway", "direction");
CREATE UNIQUE INDEX "ParkingLocation_provider_providerId_key" ON "ParkingLocation"("provider", "providerId");
CREATE INDEX "ParkingLocation_latitude_longitude_idx" ON "ParkingLocation"("latitude", "longitude");
CREATE INDEX "ParkingLocation_active_state_idx" ON "ParkingLocation"("active", "state");
CREATE UNIQUE INDEX "FuelStation_provider_providerId_key" ON "FuelStation"("provider", "providerId");
CREATE INDEX "FuelStation_latitude_longitude_idx" ON "FuelStation"("latitude", "longitude");
CREATE INDEX "FuelPriceObservation_stationId_fuelType_observedAt_idx" ON "FuelPriceObservation"("stationId", "fuelType", "observedAt");
CREATE INDEX "FuelPriceObservation_expiresAt_idx" ON "FuelPriceObservation"("expiresAt");
CREATE INDEX "CommunityDataReport_type_entityId_expiresAt_idx" ON "CommunityDataReport"("type", "entityId", "expiresAt");
CREATE INDEX "CommunityDataReport_userId_createdAt_idx" ON "CommunityDataReport"("userId", "createdAt");
CREATE INDEX "CommunityDataReport_moderationStatus_createdAt_idx" ON "CommunityDataReport"("moderationStatus", "createdAt");
CREATE UNIQUE INDEX "CommunityDataVote_reportId_userId_key" ON "CommunityDataVote"("reportId", "userId");
CREATE INDEX "CommunityDataVote_userId_createdAt_idx" ON "CommunityDataVote"("userId", "createdAt");
CREATE UNIQUE INDEX "DotRoadEvent_provider_providerEventId_key" ON "DotRoadEvent"("provider", "providerEventId");
CREATE INDEX "DotRoadEvent_active_type_severity_idx" ON "DotRoadEvent"("active", "type", "severity");
CREATE INDEX "DotRoadEvent_latitude_longitude_idx" ON "DotRoadEvent"("latitude", "longitude");
CREATE INDEX "DotRoadEvent_endsAt_idx" ON "DotRoadEvent"("endsAt");
CREATE UNIQUE INDEX "TrafficCamera_provider_providerCameraId_key" ON "TrafficCamera"("provider", "providerCameraId");
CREATE INDEX "TrafficCamera_active_latitude_longitude_idx" ON "TrafficCamera"("active", "latitude", "longitude");
CREATE UNIQUE INDEX "ProviderSyncState_provider_jurisdiction_dataType_key" ON "ProviderSyncState"("provider", "jurisdiction", "dataType");
CREATE INDEX "ProviderSyncState_status_lastSuccessAt_idx" ON "ProviderSyncState"("status", "lastSuccessAt");

ALTER TABLE "FuelPriceObservation" ADD CONSTRAINT "FuelPriceObservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "FuelStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDataReport" ADD CONSTRAINT "CommunityDataReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDataVote" ADD CONSTRAINT "CommunityDataVote_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CommunityDataReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDataVote" ADD CONSTRAINT "CommunityDataVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
