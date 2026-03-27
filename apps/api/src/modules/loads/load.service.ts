import { prisma } from "../../lib/prisma.js";

export async function createLoad(data: {
  brokerName: string;
  shipperName?: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickupAt?: string;
  deliveryAt?: string;
  equipmentType: string;
  weightLbs?: number;
  rateUsd?: number;
  notes?: string;
}) {
  return prisma.load.create({
    data: {
      brokerName: data.brokerName,
      shipperName: data.shipperName,
      originCity: data.originCity,
      originState: data.originState,
      destinationCity: data.destinationCity,
      destinationState: data.destinationState,
      pickupAt: data.pickupAt ? new Date(data.pickupAt) : undefined,
      deliveryAt: data.deliveryAt ? new Date(data.deliveryAt) : undefined,
      equipmentType: data.equipmentType,
      weightLbs: data.weightLbs,
      rateUsd: data.rateUsd,
      notes: data.notes,
    },
  });
}

export async function listLoads() {
  return prisma.load.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function updateLoadStatus(loadId: string, status: any) {
  return prisma.load.update({
    where: { id: loadId },
    data: { status },
  });
}
