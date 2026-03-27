import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { getFleetAnalytics } from "./analytics.service.js";

export const analyticsRouter = Router();

analyticsRouter.get("/fleet", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (_req, res) => {
  const data = await getFleetAnalytics();
  res.json(data);
});
