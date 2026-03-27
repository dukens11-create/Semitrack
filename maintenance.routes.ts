import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const maintenanceRouter = Router();

maintenanceRouter.post("/", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = z.object({
    truckId: z.string().min(5),
    title: z.string().min(2),
    dueDate: z.string().datetime().optional(),
    dueMiles: z.number().optional(),
    dueEngineHours: z.number().optional(),
    notes: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.maintenanceItem.create({
    data: {
      truckId: parsed.data.truckId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      dueMiles: parsed.data.dueMiles,
      dueEngineHours: parsed.data.dueEngineHours,
      notes: parsed.data.notes,
    },
  });

  res.json(item);
});

maintenanceRouter.get("/", requireAuth, async (_req, res) => {
  const items = await prisma.maintenanceItem.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  res.json({ items });
});

maintenanceRouter.patch("/:itemId/status", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = z.object({ status: z.enum(["OPEN", "DONE", "OVERDUE"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.maintenanceItem.update({
    where: { id: req.params.itemId },
    data: { status: parsed.data.status },
  });

  res.json(item);
});
