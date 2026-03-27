import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "http";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "./lib/prisma.js";
import { env } from "./config/env.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { signToken } from "./utils/jwt.js";
import { comparePassword, hashPassword } from "./utils/password.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (_req, res) => {
  res.json({ name: "Semitrack API Phase 2", status: "ok" });
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["DRIVER", "ADMIN", "FLEET_ADMIN"]).optional()
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email }
  });

  if (existing) {
    return res.status(409).json({ error: "Email already exists" });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role ?? "DRIVER"
    }
  });

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    }
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email }
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await comparePassword(parsed.data.password, user.passwordHash);

  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      plan: user.plan
    }
  });
});

app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId }
  });

  res.json(user);
});

app.get("/admin/users", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN"]), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" }
  });

  res.json({ items: users });
});

httpServer.listen(env.port, () => {
  console.log(`Semitrack API running on http://localhost:${env.port}`);
});
