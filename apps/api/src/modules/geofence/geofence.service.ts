import { prisma } from "../../lib/prisma.js";

function haversineFeet(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 20925524.9;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function detectTripGeofenceEvent(input: {
  tripId: string;
  currentLat: number;
  currentLng: number;
  thresholdFt?: number;
}) {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
  });

  if (!trip) throw new Error("Trip not found");

  const thresholdFt = input.thresholdFt ?? 1000;
  const originDistance = haversineFeet(input.currentLat, input.currentLng, trip.originLat, trip.originLng);
  const destinationDistance = haversineFeet(input.currentLat, input.currentLng, trip.destinationLat, trip.destinationLng);

  let type: string | null = null;
  let distanceFt: number | null = null;

  if (originDistance <= thresholdFt) {
    type = "NEAR_PICKUP";
    distanceFt = originDistance;
  } else if (destinationDistance <= thresholdFt) {
    type = "NEAR_DELIVERY";
    distanceFt = destinationDistance;
  }

  if (!type) {
    return { matched: false };
  }

  const event = await prisma.geofenceEvent.create({
    data: {
      tripId: input.tripId,
      type,
      lat: input.currentLat,
      lng: input.currentLng,
      distanceFt,
    },
  });

  return { matched: true, event };
}
