import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { uploadDocument } from "../../services/storageService.js";

const upload = multer({ storage: multer.memoryStorage() });
export const documentRouter = Router();

documentRouter.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File required" });

  const parsed = z.object({
    type: z.enum(["BOL", "POD", "INVOICE", "RATE_CONFIRMATION", "SETTLEMENT", "GENERAL"]).default("GENERAL"),
    tripId: z.string().optional(),
    loadId: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const uploaded = await uploadDocument(req.file.originalname, req.file.mimetype, req.file.buffer);

  const doc = await prisma.document.create({
    data: {
      userId: req.user!.userId,
      tripId: parsed.data.tripId,
      loadId: parsed.data.loadId,
      type: parsed.data.type,
      fileName: uploaded.fileName,
      fileUrl: uploaded.fileUrl,
    },
  });

  res.json(doc);
});

documentRouter.get("/", requireAuth, async (req, res) => {
  const items = await prisma.document.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ items });
});
