import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const tripStatusRouter = Router();

const updateTripStatusSchema = z.object({
  status: z.enum([
    "PLANNED",
    "ASSIGNED",
    "STARTED",
    "ARRIVED_PICKUP",
    "LOADED",
    "IN_TRANSIT",
    "ARRIVED_DELIVERY",
    "DELIVERED",
    "CLOSED",
  ]),
  notes: z.string().optional(),
});

tripStatusRouter.patch("/:tripId/status", requireAuth, async (req, res) => {
  const parsed = updateTripStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const trip = await prisma.trip.update({
    where: { id: req.params.tripId },
    data: {
      status: parsed.data.status,
      statusLogs: {
        create: {
          status: parsed.data.status,
          notes: parsed.data.notes,
        },
      },
    },
    include: {
      statusLogs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  res.json(trip);
});
