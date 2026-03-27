import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { assignTripToDriver } from "./dispatch.service.js";
import { createNotification } from "../notifications/notification.service.js";

export const dispatchRouter = Router();

const assignSchema = z.object({
  tripId: z.string().min(5),
  driverId: z.string().min(5),
  truckId: z.string().optional(),
  loadId: z.string().optional(),
  message: z.string().min(2),
});

dispatchRouter.post("/assign", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const trip = await assignTripToDriver({
    ...parsed.data,
    senderId: req.user!.userId,
  });

  await createNotification({
    userId: parsed.data.driverId,
    type: "DISPATCH",
    title: "New dispatch assigned",
    body: parsed.data.message,
  });

  res.json(trip);
});
