import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.js";
import { latestEldSnapshots, syncMotiveEld, syncSamsaraEld } from "./eld.service.js";

export const eldRouter = Router();

eldRouter.post("/sync/samsara", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (_req, res) => {
  const result = await syncSamsaraEld();
  res.json(result);
});

eldRouter.post("/sync/motive", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (_req, res) => {
  const result = await syncMotiveEld();
  res.json(result);
});

eldRouter.get("/snapshots", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (_req, res) => {
  const items = await latestEldSnapshots();
  res.json({ items });
});
