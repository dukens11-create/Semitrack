import { prisma } from "../../../lib/prisma.js";
import { SamsaraProvider } from "./samsara.provider.js";
import { MotiveProvider } from "./motive.provider.js";

const samsara = new SamsaraProvider(process.env.SAMSARA_API_TOKEN ?? "");
const motive = new MotiveProvider(process.env.MOTIVE_API_TOKEN ?? "");

export async function syncSamsaraEld() {
  const [clocks, locations] = await Promise.all([
    samsara.getDriverClocks(),
    samsara.getVehicleLocations(),
  ]);

  for (const item of clocks) {
    await prisma.eldSnapshot.create({
      data: {
        provider: item.provider,
        driverExternalId: item.driverId,
        dutyStatus: item.dutyStatus ?? undefined,
        breakMinutesLeft: item.breakMinutesLeft ?? undefined,
        driveMinutesLeft: item.driveMinutesLeft ?? undefined,
        shiftMinutesLeft: item.shiftMinutesLeft ?? undefined,
        cycleMinutesLeft: item.cycleMinutesLeft ?? undefined,
        rawJson: item as any,
      },
    });
  }

  for (const item of locations) {
    await prisma.eldSnapshot.create({
      data: {
        provider: item.provider,
        vehicleExternalId: item.vehicleId,
        latitude: item.latitude,
        longitude: item.longitude,
        rawJson: item as any,
      },
    });
  }

  return {
    clocksSynced: clocks.length,
    locationsSynced: locations.length,
  };
}

export async function syncMotiveEld() {
  const [clocks, locations] = await Promise.all([
    motive.getDriverClocks(),
    motive.getVehicleLocations(),
  ]);

  return {
    clocksSynced: clocks.length,
    locationsSynced: locations.length,
  };
}

export async function latestEldSnapshots() {
  return prisma.eldSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
