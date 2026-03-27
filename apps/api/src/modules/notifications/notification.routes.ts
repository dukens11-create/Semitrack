import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listNotifications, markNotificationRead } from "./notification.service.js";

export const notificationRouter = Router();

notificationRouter.get("/", requireAuth, async (req, res) => {
  const items = await listNotifications(req.user!.userId);
  res.json({ items });
});

notificationRouter.patch("/:notificationId/read", requireAuth, async (req, res) => {
  const item = await markNotificationRead(req.params.notificationId);
  res.json(item);
});
