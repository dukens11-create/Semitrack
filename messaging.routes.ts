import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const messagingRouter = Router();

messagingRouter.post("/threads", requireAuth, async (req, res) => {
  const parsed = z.object({
    type: z.enum(["TRIP", "LOAD", "DISPATCH", "GENERAL"]),
    title: z.string().min(2),
    tripId: z.string().optional(),
    loadId: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const thread = await prisma.messageThread.create({ data: parsed.data });
  res.json(thread);
});

messagingRouter.post("/threads/:threadId/messages", requireAuth, async (req, res) => {
  const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const message = await prisma.message.create({
    data: {
      threadId: req.params.threadId,
      senderId: req.user!.userId,
      body: parsed.data.body,
    },
  });

  res.json(message);
});

messagingRouter.get("/threads/:threadId", requireAuth, async (req, res) => {
  const thread = await prisma.messageThread.findUnique({
    where: { id: req.params.threadId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { id: true, fullName: true, role: true } } },
      },
    },
  });

  res.json(thread);
});
