import { z } from "zod";

export const createLoadSchema = z.object({
  brokerName: z.string().min(2),
  shipperName: z.string().optional(),
  originCity: z.string().min(2),
  originState: z.string().min(2),
  destinationCity: z.string().min(2),
  destinationState: z.string().min(2),
  pickupAt: z.string().datetime().optional(),
  deliveryAt: z.string().datetime().optional(),
  equipmentType: z.string().min(2),
  weightLbs: z.number().optional(),
  rateUsd: z.number().optional(),
  notes: z.string().optional(),
});

export const updateLoadStatusSchema = z.object({
  status: z.enum([
    "DRAFT",
    "ASSIGNED",
    "IN_TRANSIT",
    "AT_PICKUP",
    "LOADED",
    "AT_DELIVERY",
    "DELIVERED",
    "CANCELED",
  ]),
});
