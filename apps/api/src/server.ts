import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { disconnectDatabase, prisma } from "./lib/prisma.js";
import { isDatabaseUnavailableError } from "./lib/databaseErrors.js";
import { env } from "./config/env.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { signAccessToken } from "./utils/jwt.js";
import { comparePassword, hashPassword } from "./utils/password.js";
import {
  buildTrafficPreview,
  buildTruckRoute,
  compareRoutes,
  configuredRoutingProviderName,
} from "./services/routingService.js";
import { RoutingProviderError } from "./services/providers/routeProvider.js";
import {
  decryptSecret,
  eldConfig,
  eldGet,
  encryptSecret,
  exchangeAuthorizationCode,
  refreshProviderToken,
  normalizeEldSnapshot,
  revokeProviderToken,
  type EldProviderName,
} from "./services/eldService.js";
import { safetyRouter } from "./modules/safety/safety.routes.js";
import { refreshDotProviders } from "./services/dotFeedService.js";
import {
  searchHerePlaces,
  searchHerePlacesAlongRoute,
} from "./services/providers/herePlacesProvider.js";
import { resolveHereTimeZone } from "./services/providers/hereTimeZoneProvider.js";
import { adminAnalyticsRouter, telemetryRouter } from "./modules/analytics/adminAnalytics.routes.js";
import {
  adminSubscriptionPlansRouter,
  publicSubscriptionPlansRouter,
} from "./modules/subscriptions/subscriptionPlans.routes.js";
import { adminAccountRouter } from "./modules/admin/adminAccount.routes.js";
import { adminEntitlementRouter, entitlementRouter } from "./modules/billing/entitlement.routes.js";
import { adminPilotRouter, pilotRouter } from "./modules/billing/pilot.routes.js";
import { BillingFoundationError } from "./modules/billing/billingErrors.js";
import {
  requireAllowedStripeWebOrigin,
  requireBillingEnabled,
} from "./modules/billing/billingMode.middleware.js";

const app = express();
app.disable("x-powered-by");
const allowedCorsOrigins = new Set([...env.corsOrigins, ...env.stripeAllowedWebOrigins]);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, allowedCorsOrigins.has(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  const started = Date.now();
  res.on("finish", () => {
    console.info(JSON.stringify({
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    }));
  });
  next();
});

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use((req, res, next) => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 120) {
    res.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
  }
  return next();
});

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const issueRefreshToken = () => crypto.randomBytes(48).toString("base64url");
const publicUser = (user: any) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  phone: user.phone,
  role: user.role,
  plan: user.plan,
  emailVerified: user.emailVerified,
});

const adminRoles = ["ADMIN", "FLEET_ADMIN", "MODERATOR"];
const userManagementRoles = ["ADMIN", "FLEET_ADMIN"];

function adminPagination(query: Request["query"]) {
  const page = z.coerce.number().int().min(1).default(1).parse(query.page);
  const pageSize = z.coerce.number().int().min(1).max(100).default(50).parse(query.pageSize);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

async function issueSession(user: any) {
  const accessToken = signAccessToken({ userId: user.id, email: user.email, role: user.role });
  const refreshToken = issueRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.refreshTokenDays * 86_400_000),
    },
  });
  return { accessToken, refreshToken, user: publicUser(user) };
}

app.get("/health", asyncRoute(async (_req, res) => {
  let database = "ok";
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    database = "unavailable";
  }
  const status = database === "ok" ? 200 : 503;
  res.status(status).json({
    status: database === "ok" ? "ok" : "degraded",
    database,
    providers: {
      selectedTruckRoutingProvider: configuredRoutingProviderName(),
      hereRoutingConfigured: Boolean(env.hereApiKey),
      trimbleRoutingConfigured: Boolean(env.trimbleApiKey),
      mapboxTrafficConfigured: Boolean(env.mapboxToken),
      eldEncryptionConfigured: env.eldEncryptionKey.length >= 32,
      billingMode: env.billingMode,
      googlePlayBillingConfigured: false,
      appleBillingConfigured: false,
      stripeBillingConfigured: env.billingMode === "test" && Boolean(env.stripeSecretKey && env.stripeWebhookSecret),
    },
  });
}));

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});
app.post("/auth/register", asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "Email already exists" } });
  const user = await prisma.user.create({
    data: { fullName: input.fullName, email: input.email, passwordHash: await hashPassword(input.password) },
  });
  res.status(201).json(await issueSession(user));
}));

app.post("/auth/login", asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || user.disabledAt || !(await comparePassword(input.password, user.passwordHash))) {
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } });
  }
  res.json(await issueSession(user));
}));

app.post("/auth/refresh", asyncRoute(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(40) }).parse(req.body);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt <= new Date() || record.user.disabledAt) {
    return res.status(401).json({ error: { code: "INVALID_REFRESH_TOKEN", message: "Session expired" } });
  }
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  res.json(await issueSession(record.user));
}));

app.post("/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
  if (parsed.refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.userId, tokenHash: hashToken(parsed.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.status(204).end();
}));

app.post("/auth/password-reset/request", asyncRoute(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user) {
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const rawToken = issueRefreshToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    if (!env.passwordResetBaseUrl) {
      console.warn("Password reset requested but PASSWORD_RESET_BASE_URL/email delivery is not configured");
    }
  }
  res.status(202).json({ accepted: true });
}));

app.post("/auth/password-reset/confirm", asyncRoute(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(40), password: z.string().min(10).max(128) }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    return res.status(400).json({ error: { code: "INVALID_RESET_TOKEN", message: "Reset token is invalid or expired" } });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  res.status(204).end();
}));

app.get("/me", requireAuth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  res.json(publicUser(user));
}));

app.patch("/me", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({ fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(30).nullable().optional() }).parse(req.body);
  const user = await prisma.user.update({ where: { id: req.user!.userId }, data: input });
  res.json(publicUser(user));
}));

const truckFields = {
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  tractorType: z.string().max(80).nullable().optional(),
  trailerType: z.string().max(80).nullable().optional(),
  trailerCount: z.number().int().min(0).max(4).default(1),
  unitNumber: z.string().max(40).nullable().optional(),
  trailerNumber: z.string().max(40).nullable().optional(),
  heightFt: z.number().min(4).max(20),
  currentWeightLbs: z.number().int().min(1_000).max(300_000).nullable().optional(),
  weightLbs: z.number().int().min(1_000).max(300_000),
  weightPerAxleLbs: z.number().int().min(500).max(100_000).nullable().optional(),
  widthFt: z.number().min(4).max(20),
  lengthFt: z.number().min(8).max(150),
  hazmatEnabled: z.boolean().default(false),
  hazardousGoods: z.array(z.enum(["explosive","gas","flammable","combustible","organic","poison","radioactive","corrosive","poisonousInhalation","harmfulToWater","other"])).default([]),
  axleCount: z.number().int().min(2).max(20),
  avoidTolls: z.boolean().default(false),
  avoidFerries: z.boolean().default(false),
  avoidHighways: z.boolean().default(false),
  avoidResidential: z.boolean().default(true),
  avoidDirtRoads: z.boolean().default(true),
};
const truckBaseSchema = z.object(truckFields);
const validateTruck = (value: z.infer<typeof truckBaseSchema>, ctx: z.RefinementCtx) => {
  if (value.currentWeightLbs && value.currentWeightLbs > value.weightLbs) {
    ctx.addIssue({ code: "custom", path: ["currentWeightLbs"], message: "Current weight cannot exceed gross weight" });
  }
  if (value.hazmatEnabled && value.hazardousGoods.length === 0) {
    ctx.addIssue({ code: "custom", path: ["hazardousGoods"], message: "Select at least one hazardous-goods class" });
  }
};
const truckSchema = truckBaseSchema.superRefine(validateTruck);
const truckUpdateSchema = truckBaseSchema.partial();

app.get("/trucks", requireAuth, asyncRoute(async (req, res) => {
  res.json({ items: await prisma.truck.findMany({ where: { userId: req.user!.userId }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }) });
}));
app.post("/trucks", requireAuth, asyncRoute(async (req, res) => {
  const input = truckSchema.parse(req.body);
  const count = await prisma.truck.count({ where: { userId: req.user!.userId } });
  const makeDefault = input.isDefault === true || count === 0;
  const truck = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.truck.updateMany({ where: { userId: req.user!.userId }, data: { isDefault: false } });
    return tx.truck.create({ data: { ...input, isDefault: makeDefault, userId: req.user!.userId } });
  });
  res.status(201).json(truck);
}));
app.patch("/trucks/:id", requireAuth, asyncRoute(async (req, res) => {
  const input = truckUpdateSchema.parse(req.body);
  const existing = await prisma.truck.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!existing) return res.status(404).json({ error: { code: "TRUCK_NOT_FOUND", message: "Truck profile not found" } });
  const truck = await prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.truck.updateMany({ where: { userId: req.user!.userId }, data: { isDefault: false } });
    return tx.truck.update({ where: { id: existing.id }, data: input });
  });
  res.json(truck);
}));
app.post("/trucks/:id/default", requireAuth, asyncRoute(async (req, res) => {
  const existing = await prisma.truck.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!existing) return res.status(404).json({ error: { code: "TRUCK_NOT_FOUND", message: "Truck profile not found" } });
  await prisma.$transaction([
    prisma.truck.updateMany({ where: { userId: req.user!.userId }, data: { isDefault: false } }),
    prisma.truck.update({ where: { id: existing.id }, data: { isDefault: true } }),
  ]);
  res.status(204).end();
}));
app.delete("/trucks/:id", requireAuth, asyncRoute(async (req, res) => {
  const existing = await prisma.truck.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!existing) return res.status(404).json({ error: { code: "TRUCK_NOT_FOUND", message: "Truck profile not found" } });
  const count = await prisma.truck.count({ where: { userId: req.user!.userId } });
  if (count === 1) return res.status(409).json({ error: { code: "LAST_TRUCK", message: "At least one truck profile is required" } });
  await prisma.truck.delete({ where: { id: existing.id } });
  if (existing.isDefault) {
    const replacement = await prisma.truck.findFirst({ where: { userId: req.user!.userId }, orderBy: { updatedAt: "desc" } });
    if (replacement) await prisma.truck.update({ where: { id: replacement.id }, data: { isDefault: true } });
  }
  res.status(204).end();
}));

app.get("/navigation-settings", requireAuth, asyncRoute(async (req, res) => {
  const settings = await prisma.navigationSettings.upsert({
    where: { userId: req.user!.userId },
    create: { userId: req.user!.userId },
    update: {},
  });
  res.json(settings);
}));
app.put("/navigation-settings", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    voiceEnabled: z.boolean(), voiceMuted: z.boolean(), voiceLocale: z.string().min(2).max(20),
    units: z.enum(["imperial", "metric"]), dayNightMode: z.enum(["system", "day", "night"]),
    trafficReroute: z.boolean(), settingsJson: z.record(z.unknown()).nullable().optional(),
  }).parse(req.body);
  res.json(await prisma.navigationSettings.upsert({
    where: { userId: req.user!.userId },
    create: { ...input, userId: req.user!.userId, settingsJson: input.settingsJson as any },
    update: { ...input, settingsJson: input.settingsJson as any },
  }));
}));

const coordinate = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const routeSchema = z.object({
  origin: coordinate,
  destination: coordinate,
  viaStops: z.array(coordinate).max(20).optional(),
  truck: truckBaseSchema.omit({ name: true, isDefault: true, tractorType: true, unitNumber: true, trailerNumber: true }),
  routeMode: z.enum(["fastest", "fuel_optimized", "shortest"]).optional(),
  alternatives: z.number().int().min(0).max(5).optional(),
  avoidSegments: z.array(z.string().min(1)).max(250).optional(),
});
app.post("/routing/truck-route", requireAuth, asyncRoute(async (req, res) => {
  const input = routeSchema.parse(req.body);
  res.json(await buildTruckRoute(input));
}));
app.post("/routing/traffic-preview", requireAuth, asyncRoute(async (req, res) => {
  const input = routeSchema.parse(req.body);
  res.json(await buildTrafficPreview(input));
}));
app.post("/routing/compare", requireAuth, asyncRoute(async (req, res) => {
  const input = routeSchema.parse(req.body);
  res.json(await compareRoutes(input));
}));
app.get("/location/timezone", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }).parse(req.query);
  res.json(await resolveHereTimeZone(input.lat, input.lng));
}));

const placeCategory = z.enum([
  "walmart_store",
  "weigh_station",
  "truck_stop",
  "rest_area",
  "fuel_stop",
  "truck_parking",
  "truck_wash",
]);
app.get("/places/search", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    category: placeCategory,
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(100).max(100_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).parse(req.query);
  const items = await searchHerePlaces({
    category: input.category,
    center: { lat: input.lat, lng: input.lng },
    radiusMeters: input.radiusMeters,
    limit: input.limit,
  });
  res.json({
    items,
    provider: "HERE",
    regulatoryAuthority: false,
    generatedAt: new Date().toISOString(),
  });
}));
app.post("/places/corridor", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    category: placeCategory,
    route: z.array(coordinate).min(2).max(2_000),
    radiusMeters: z.number().int().min(100).max(100_000).optional(),
    maxResults: z.number().int().min(1).max(250).optional(),
  }).parse(req.body);
  const items = await searchHerePlacesAlongRoute(input);
  res.json({
    items,
    provider: "HERE",
    regulatoryAuthority: false,
    generatedAt: new Date().toISOString(),
  });
}));

app.get("/favorites", requireAuth, asyncRoute(async (req, res) => {
  res.json({ items: await prisma.favorite.findMany({ where: { userId: req.user!.userId }, orderBy: { updatedAt: "desc" } }) });
}));
app.post("/favorites", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().min(1).max(120), category: z.string().max(80).optional(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), address: z.string().max(300).optional() }).parse(req.body);
  res.status(201).json(await prisma.favorite.create({ data: { ...input, userId: req.user!.userId } }));
}));
app.delete("/favorites/:id", requireAuth, asyncRoute(async (req, res) => {
  const result = await prisma.favorite.deleteMany({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!result.count) return res.status(404).json({ error: { code: "FAVORITE_NOT_FOUND", message: "Favorite not found" } });
  res.status(204).end();
}));

const reportSchema = z.object({
  type: z.enum(["SAFETY_REPORT", "POI_CORRECTION", "USER_REPORT", "PARKING_REPORT"]),
  subjectId: z.string().max(120).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  category: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  evidenceJson: z.record(z.unknown()).optional(),
  expiresAt: z.coerce.date().optional(),
});
app.post("/community/reports", requireAuth, asyncRoute(async (req, res) => {
  const input = reportSchema.parse(req.body);
  const report = await prisma.communityReport.create({ data: { ...input, evidenceJson: input.evidenceJson as any, userId: req.user!.userId } });
  res.status(201).json(report);
}));
app.get("/admin/reports", requireAuth, requireRole(["ADMIN", "FLEET_ADMIN", "MODERATOR"]), asyncRoute(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ items: await prisma.communityReport.findMany({ where: status ? { status: status as any } : {}, orderBy: { createdAt: "desc" }, take: 200 }) });
}));
app.patch("/admin/reports/:id", requireAuth, requireRole(["ADMIN", "MODERATOR"]), asyncRoute(async (req, res) => {
  const input = z.object({
    status: z.enum(["APPROVED", "REJECTED", "REMOVED", "EXPIRED"]),
    reason: z.string().min(3).max(500),
    duplicateOfId: z.string().nullable().optional(),
  }).parse(req.body);
  const report = await prisma.communityReport.update({
    where: { id: String(req.params.id) },
    data: { status: input.status, moderationReason: input.reason, duplicateOfId: input.duplicateOfId, moderatorId: req.user!.userId, moderatedAt: new Date() },
  });
  res.json(report);
}));

app.get("/eld/connections", requireAuth, asyncRoute(async (req, res) => {
  const items = await prisma.eldConnection.findMany({
    where: { userId: req.user!.userId },
    select: { id: true, provider: true, providerAccountId: true, scopes: true, status: true, lastSyncedAt: true, lastErrorCode: true, lastErrorMessage: true, createdAt: true, updatedAt: true },
  });
  res.json({ items });
}));
app.post("/eld/:provider/connect", requireAuth, asyncRoute(async (req, res) => {
  const provider = z.enum(["SAMSARA", "MOTIVE"]).parse(String(req.params.provider).toUpperCase());
  const configured = provider === "SAMSARA"
    ? Boolean(env.samsaraClientId && env.samsaraClientSecret && env.samsaraRedirectUri)
    : Boolean(env.motiveClientId && env.motiveClientSecret && env.motiveRedirectUri);
  if (!configured) {
    return res.status(503).json({ error: { code: "ELD_PROVIDER_NOT_CONFIGURED", message: `${provider} OAuth credentials are required` } });
  }
  const state = crypto.randomBytes(32).toString("base64url");
  await prisma.eldConnection.upsert({
    where: { userId_provider: { userId: req.user!.userId, provider } },
    create: { userId: req.user!.userId, provider, status: "PENDING" },
    update: { status: "PENDING", lastErrorCode: null, lastErrorMessage: null },
  });
  await prisma.eldOAuthState.create({
    data: {
      userId: req.user!.userId,
      provider,
      stateHash: hashToken(state),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const clientId = provider === "SAMSARA" ? env.samsaraClientId : env.motiveClientId;
  const redirectUri = provider === "SAMSARA" ? env.samsaraRedirectUri : env.motiveRedirectUri;
  const authorizeBase = provider === "SAMSARA" ? "https://api.samsara.com/oauth2/authorize" : "https://gomotive.com/oauth/authorize";
  const authorizeUrl = new URL(authorizeBase);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  res.json({ authorizeUrl: authorizeUrl.toString() });
}));

app.get("/eld/:provider/callback", asyncRoute(async (req, res) => {
  const provider = z.enum(["SAMSARA", "MOTIVE"]).parse(String(req.params.provider).toUpperCase()) as EldProviderName;
  const { state, code } = z.object({ state: z.string().min(20), code: z.string().min(2) }).parse(req.query);
  const oauthState = await prisma.eldOAuthState.findUnique({ where: { stateHash: hashToken(state) } });
  if (!oauthState || oauthState.provider !== provider || oauthState.usedAt || oauthState.expiresAt <= new Date()) {
    return res.status(400).json({ error: { code: "INVALID_OAUTH_STATE", message: "OAuth state is invalid or expired" } });
  }
  const tokens = await exchangeAuthorizationCode(provider, code);
  await prisma.$transaction([
    prisma.eldOAuthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } }),
    prisma.eldConnection.update({
      where: { userId_provider: { userId: oauthState.userId, provider } },
      data: {
        encryptedAccessToken: encryptSecret(tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: "CONNECTED",
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    }),
  ]);
  res.json({ connected: true, provider });
}));

async function eldAccessToken(connection: any) {
  if (!connection.encryptedAccessToken) throw new Error("ELD connection has no access token");
  if (!connection.accessTokenExpiresAt || connection.accessTokenExpiresAt > new Date(Date.now() + 60_000)) {
    return decryptSecret(connection.encryptedAccessToken);
  }
  if (!connection.encryptedRefreshToken) throw new Error("ELD connection requires reauthorization");
  const tokens = await refreshProviderToken(connection.provider, decryptSecret(connection.encryptedRefreshToken));
  await prisma.eldConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : connection.encryptedRefreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes.length ? tokens.scopes : connection.scopes,
      status: "CONNECTED",
    },
  });
  return tokens.accessToken;
}

app.post("/eld/:provider/sync", requireAuth, asyncRoute(async (req, res) => {
  const provider = z.enum(["SAMSARA", "MOTIVE"]).parse(String(req.params.provider).toUpperCase()) as EldProviderName;
  const connection = await prisma.eldConnection.findUnique({
    where: { userId_provider: { userId: req.user!.userId, provider } },
  });
  if (!connection || connection.status !== "CONNECTED") {
    return res.status(409).json({ error: { code: "ELD_NOT_CONNECTED", message: "Connect the ELD provider first" } });
  }
  try {
    const token = await eldAccessToken(connection);
    const config = eldConfig(provider);
    const [drivers, vehicles, hos] = await Promise.all([
      eldGet(provider, token, config.driversPath),
      eldGet(provider, token, config.vehiclesPath),
      eldGet(provider, token, config.hosPath),
    ]);
    const syncedAt = new Date();
    const normalized = normalizeEldSnapshot(provider, { drivers, vehicles, hos });
    await prisma.eldConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        metadataJson: JSON.parse(JSON.stringify(normalized)),
      },
    });
    res.json({ ...normalized, syncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ELD sync failed";
    await prisma.eldConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastErrorCode: "SYNC_FAILED", lastErrorMessage: message },
    });
    throw error;
  }
}));
app.get("/eld/hos/current", requireAuth, asyncRoute(async (req, res) => {
  const connections = await prisma.eldConnection.findMany({
    where: { userId: req.user!.userId, status: "CONNECTED", lastSyncedAt: { not: null } },
    select: { provider: true, lastSyncedAt: true, metadataJson: true },
    orderBy: { lastSyncedAt: "desc" },
  });
  res.json({
    items: connections.flatMap((connection) => {
      const metadata = connection.metadataJson as { hos?: unknown[] } | null;
      return (metadata?.hos ?? []).map((hos) => ({ provider: connection.provider, lastSyncedAt: connection.lastSyncedAt, ...(hos as object) }));
    }),
  });
}));
app.delete("/eld/:provider", requireAuth, asyncRoute(async (req, res) => {
  const provider = z.enum(["SAMSARA", "MOTIVE"]).parse(String(req.params.provider).toUpperCase());
  const connection = await prisma.eldConnection.findUnique({
    where: { userId_provider: { userId: req.user!.userId, provider } },
  });
  if (connection?.encryptedRefreshToken) {
    try {
      await revokeProviderToken(provider, decryptSecret(connection.encryptedRefreshToken));
    } catch (error) {
      console.warn(`${provider} remote revocation failed; local credentials will still be deleted`, error);
    }
  }
  await prisma.eldConnection.updateMany({
    where: { userId: req.user!.userId, provider },
    data: { encryptedAccessToken: null, encryptedRefreshToken: null, accessTokenExpiresAt: null, status: "DISCONNECTED", scopes: [] },
  });
  res.status(204).end();
}));

app.get("/admin/overview", requireAuth, requireRole(adminRoles), asyncRoute(async (_req, res) => {
  const [users, activeSubscriptions, pendingReports, disabledUsers, providerIssues] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING"] } } }),
    prisma.communityReport.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
    prisma.providerSyncState.count({ where: { status: { in: ["DEGRADED", "ERROR"] } } }),
  ]);
  res.json({
    users,
    activeSubscriptions,
    pendingReports,
    disabledUsers,
    providerIssues,
    generatedAt: new Date(),
  });
}));

app.get("/admin/application", requireAuth, requireRole(adminRoles), asyncRoute(async (_req, res) => {
  res.json({
    name: "SemiTraX",
    version: env.appVersion,
    buildSha: env.appBuildSha || null,
    environment: env.nodeEnv,
    supportedRoles: ["DRIVER", "MODERATOR", "FLEET_ADMIN", "ADMIN"],
    providers: {
      hereRoutingConfigured: Boolean(env.hereApiKey),
      mapboxTrafficConfigured: Boolean(env.mapboxToken),
      dot511Configured: env.dotProviderConfigured,
      eldEncryptionConfigured: env.eldEncryptionKey.length >= 32,
      samsaraConfigured: Boolean(env.samsaraClientId && env.samsaraClientSecret),
      motiveConfigured: Boolean(env.motiveClientId && env.motiveClientSecret),
      stripeConfigured: Boolean(env.stripeSecretKey),
    },
  });
}));

app.get("/admin/users", requireAuth, requireRole(userManagementRoles), asyncRoute(async (req, res) => {
  const { page, pageSize, skip } = adminPagination(req.query);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const where = search
    ? { OR: [
        { email: { contains: search, mode: "insensitive" as const } },
        { fullName: { contains: search, mode: "insensitive" as const } },
      ] }
    : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        plan: true,
        emailVerified: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, page, pageSize, total });
}));

app.patch("/admin/users/:id", requireAuth, requireRole(["ADMIN"]), asyncRoute(async (req, res) => {
  const targetId = String(req.params.id);
  const input = z.object({
    role: z.enum(["DRIVER", "ADMIN", "FLEET_ADMIN", "MODERATOR"]).optional(),
    disabled: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500),
  }).refine((value) => value.role !== undefined || value.disabled !== undefined, {
    message: "A role or disabled change is required",
  }).parse(req.body);

  const current = await prisma.user.findUnique({ where: { id: targetId } });
  if (!current) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }
  if (targetId === req.user!.userId && (input.disabled === true || (input.role && input.role !== "ADMIN"))) {
    return res.status(409).json({ error: { code: "SELF_LOCKOUT_BLOCKED", message: "Administrators cannot disable or demote their own account" } });
  }
  if (current.role === "ADMIN" && (input.disabled === true || (input.role && input.role !== "ADMIN"))) {
    const activeAdminCount = await prisma.user.count({ where: { role: "ADMIN", disabledAt: null } });
    if (activeAdminCount <= 1) {
      return res.status(409).json({ error: { code: "LAST_ADMIN_BLOCKED", message: "The final active administrator cannot be disabled or demoted" } });
    }
  }

  const disabledAt = input.disabled === undefined
    ? current.disabledAt
    : input.disabled ? new Date() : null;
  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { role: input.role, disabledAt },
      select: { id: true, fullName: true, email: true, role: true, plan: true, emailVerified: true, disabledAt: true, updatedAt: true },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorUserId: req.user!.userId,
        action: "USER_ACCESS_UPDATED",
        targetType: "USER",
        targetId,
        ipAddress: req.ip,
        metadataJson: {
          reason: input.reason,
          previousRole: current.role,
          newRole: input.role ?? current.role,
          previousDisabled: Boolean(current.disabledAt),
          newDisabled: Boolean(disabledAt),
        },
      },
    }),
  ]);
  res.json(updated);
}));

app.get("/admin/subscriptions", requireBillingEnabled, requireAuth, requireRole(userManagementRoles), asyncRoute(async (req, res) => {
  const { page, pageSize, skip } = adminPagination(req.query);
  const status = req.query.status
    ? z.enum([
      "INACTIVE", "ACTIVE", "TRIALING", "GRACE_PERIOD", "BILLING_RETRY", "PAST_DUE",
      "PAUSED", "CANCEL_AT_PERIOD_END", "CANCELED", "EXPIRED", "REFUNDED", "REVOKED",
    ]).parse(String(req.query.status))
    : undefined;
  const where = status ? { status } : {};
  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        provider: true,
        productId: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        canceledAt: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);
  res.json({ items, page, pageSize, total });
}));

app.get("/admin/provider-health", requireAuth, requireRole(adminRoles), asyncRoute(async (_req, res) => {
  const items = await prisma.providerSyncState.findMany({
    orderBy: [{ status: "asc" }, { lastSuccessAt: "desc" }],
    select: {
      id: true,
      provider: true,
      jurisdiction: true,
      dataType: true,
      status: true,
      refreshIntervalSec: true,
      lastAttemptAt: true,
      lastSuccessAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      itemCount: true,
      updatedAt: true,
    },
  });
  res.json({ items });
}));

app.get("/admin/audit-logs", requireAuth, requireRole(["ADMIN"]), asyncRoute(async (req, res) => {
  const { page, pageSize, skip } = adminPagination(req.query);
  const [items, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadataJson: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.adminAuditLog.count(),
  ]);
  res.json({ items, page, pageSize, total });
}));

app.use("/safety", safetyRouter);
app.use("/analytics", telemetryRouter);
app.use("/admin/analytics", adminAnalyticsRouter);
app.use("/admin/account", adminAccountRouter);
app.use("/subscription-plans", requireBillingEnabled, publicSubscriptionPlansRouter);
app.use("/admin/subscription-plans", requireBillingEnabled, adminSubscriptionPlansRouter);
app.use("/entitlements", requireBillingEnabled, entitlementRouter);
app.use("/admin/entitlements", requireBillingEnabled, adminEntitlementRouter);
app.use("/pilot", requireBillingEnabled, pilotRouter);
app.use("/admin/pilot", requireBillingEnabled, adminPilotRouter);
app.use("/billing", requireBillingEnabled, requireAllowedStripeWebOrigin, (_req, res) => {
  res.status(501).json({
    error: {
      code: "BILLING_PROVIDER_NOT_IMPLEMENTED",
      message: "Stripe billing endpoints are not implemented in Phase 2.",
    },
  });
});

app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() } });
  }
  if (error instanceof BillingFoundationError) {
    return res.status(error.httpStatus).json({
      error: { code: error.code, message: error.message },
    });
  }
  if (isDatabaseUnavailableError(error)) {
    const errorName = error instanceof Error ? error.name : "UnknownDatabaseError";
    console.error(`[database] unavailable method=${_req.method} path=${_req.path} error=${errorName}`);
    return res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "SemiTraX account services are temporarily unavailable. Please try again shortly.",
        retryable: true,
      },
    });
  }
  if (error instanceof RoutingProviderError) {
    console.warn(`[routing] provider=${error.provider} code=${error.code} retryable=${error.retryable}`);
    void prisma.$executeRawUnsafe(
      `INSERT INTO "ApiErrorLog" (id, route, method, "statusCode", "errorCode", "occurredAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
      crypto.randomUUID(), _req.path.slice(0, 300), _req.method.slice(0, 12), error.httpStatus, error.code.slice(0, 120),
    ).catch(() => undefined);
    return res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.message,
        provider: error.provider,
        retryable: error.retryable,
      },
    });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  console.error(error);
  void prisma.$executeRawUnsafe(
    `INSERT INTO "ApiErrorLog" (id, route, method, "statusCode", "errorCode", "occurredAt") VALUES ($1,$2,$3,500,$4,NOW())`,
    crypto.randomUUID(), _req.path.slice(0, 300), _req.method.slice(0, 12), error instanceof Error ? error.name.slice(0, 120) : "UNKNOWN",
  ).catch(() => undefined);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: env.nodeEnv === "production" ? "Internal server error" : message },
  });
});

const server = app.listen(env.port, () => {
  console.info(`SemiTrack API listening on port ${env.port}`);
});

const dotSyncTimer = setInterval(() => {
  void refreshDotProviders().catch((error) =>
    console.error("DOT/511 provider refresh failed", error),
  );
}, 60_000);
dotSyncTimer.unref();

const shutdown = async () => {
  clearInterval(dotSyncTimer);
  server.close();
  await disconnectDatabase();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

export { app };
