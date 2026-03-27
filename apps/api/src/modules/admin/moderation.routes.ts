import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";

export const moderationRouter = Router();

moderationRouter.get("/parking-reports", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN"]), async (_req, res) => {
  const items = await prisma.parkingReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json({ items });
});

moderationRouter.delete("/parking-reports/:reportId", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN"]), async (req, res) => {
  await prisma.parkingReport.delete({
    where: { id: req.params.reportId },
  });

  res.json({ success: true });
});
