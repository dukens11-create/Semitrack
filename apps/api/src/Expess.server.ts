import express from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { prisma } from "./lib/prisma.js";
import { env } from "./config/env.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { comparePassword, hashPassword } from "./utils/password.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./utils/jwt.js";
import { buildRoute, compareRoutes } from "./services/routingService.js";
import { getRouteWeather } from "./services/weatherService.js";
import { createCheckoutSession } from "./services/stripeService.js";
import { uploadDocument } from "./services/storageService.js";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (_req, res) => {
  res.json({ name: "Semitrack API Phase 3", status: "ok", routeProvider: env.routeProvider });
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["DRIVER", "ADMIN", "FLEET_ADMIN"]).optional(),
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return res.status(409).json({ error: "Email already exists" });

  const passwordHash = await hashPassword(parsed.data.password);

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role ?? "DRIVER",
    },
  });

  const payload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      plan: user.plan,
    },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await comparePassword(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const payload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      plan: user.plan,
    },
  });
});

app.post("/auth/refresh", async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const payload = verifyRefreshToken(parsed.data.refreshToken);
    const accessToken = signAccessToken(payload);
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  res.json(user);
});

const routeSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  viaStops: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
  truck: z.object({
    heightFt: z.number(),
    weightLbs: z.number(),
    widthFt: z.number(),
    lengthFt: z.number(),
    hazmatEnabled: z.boolean(),
    axleCount: z.number(),
    avoidTolls: z.boolean().optional(),
    avoidResidential: z.boolean().optional(),
    avoidFerries: z.boolean().optional(),
  }),
  routeMode: z.enum(["fastest", "fuel_optimized", "shortest"]).optional(),
});

app.post("/routing/truck-route", requireAuth, async (req, res) => {
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const route = await buildRoute(parsed.data);
    res.json(route);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Route failed" });
  }
});

app.post("/routing/compare-providers", requireAuth, async (req, res) => {
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await compareRoutes(parsed.data);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Compare failed" });
  }
});

app.post("/weather/route", requireAuth, async (req, res) => {
  const parsed = z.object({
    points: z.array(z.object({ lat: z.number(), lng: z.number() })).min(1).max(5),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const weather = await getRouteWeather(parsed.data.points);
    res.json({ items: weather });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Weather failed" });
  }
});

app.post("/billing/checkout", requireAuth, async (req, res) => {
  const parsed = z.object({
    plan: z.enum(["GOLD", "DIAMOND", "TEAM"]),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const session = await createCheckoutSession(parsed.data.plan, req.user!.userId);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Checkout failed" });
  }
});

app.post("/documents/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File required" });

  try {
    const uploaded = await uploadDocument(
      req.file.originalname,
      req.file.mimetype,
      req.file.buffer
    );

    const doc = await prisma.document.create({
      data: {
        userId: req.user!.userId,
        type: "general",
        fileName: uploaded.fileName,
        fileUrl: uploaded.fileUrl,
      },
    });

    res.json(doc);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Upload failed" });
  }
});

app.get("/admin/users", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN"]), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      plan: true,
      createdAt: true,
    },
  });

  res.json({ items: users });
});

app.listen(env.port, () => {
  console.log(`Semitrack API running on http://localhost:${env.port}`);
});
