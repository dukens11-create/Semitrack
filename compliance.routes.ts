import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const complianceRouter = Router();

complianceRouter.post("/", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = z.object({
    truckId: z.string().min(5),
    type: z.enum(["REGISTRATION", "INSURANCE", "PERMIT", "ANNUAL_INSPECTION", "IFTA", "OTHER"]),
    title: z.string().min(2),
    expiresAt: z.string().datetime(),
    notes: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.complianceItem.create({
    data: {
      truckId: parsed.data.truckId,
      type: parsed.data.type,
      title: parsed.data.title,
      expiresAt: new Date(parsed.data.expiresAt),
      notes: parsed.data.notes,
    },
  });

  res.json(item);
});

complianceRouter.get("/expiring", requireAuth, async (req, res) => {
  const withinDays = Number(req.query.days ?? 30);
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

  const items = await prisma.complianceItem.findMany({
    where: { expiresAt: { lte: cutoff } },
    orderBy: { expiresAt: "asc" },
  });

  res.json({ items });
});
