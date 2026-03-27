import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createLoadSchema, updateLoadStatusSchema } from "./load.schemas.js";
import { createLoad, listLoads, updateLoadStatus } from "./load.service.js";

export const loadRouter = Router();

loadRouter.post("/", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = createLoadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const load = await createLoad(parsed.data);
  res.json(load);
});

loadRouter.get("/", requireAuth, async (_req, res) => {
  const loads = await listLoads();
  res.json({ items: loads });
});

loadRouter.patch("/:loadId/status", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "DISPATCHER"]), async (req, res) => {
  const parsed = updateLoadStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = await updateLoadStatus(req.params.loadId, parsed.data.status);
  res.json(updated);
});
