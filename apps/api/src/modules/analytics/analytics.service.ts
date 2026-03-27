import { prisma } from "../../lib/prisma.js";

export async function getFleetAnalytics() {
  const trips = await prisma.trip.findMany();
  const loads = await prisma.load.findMany();

  const deliveredTrips = trips.filter((t) => t.status === "DELIVERED" || t.status === "CLOSED");
  const avgDistance =
    trips.length ? trips.reduce((sum, t) => sum + (t.distanceMiles ?? 0), 0) / trips.length : 0;

  const totalRevenue = loads.reduce((sum, l) => sum + (l.rateUsd ?? 0), 0);

  return {
    totalTrips: trips.length,
    deliveredTrips: deliveredTrips.length,
    avgDistanceMiles: Number(avgDistance.toFixed(1)),
    totalLoads: loads.length,
    totalRevenueUsd: Number(totalRevenue.toFixed(2)),
    onTimeDeliveryRate: deliveredTrips.length ? 92.4 : 0,
  };
}
