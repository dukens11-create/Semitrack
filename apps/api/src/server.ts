import { CorridorCorrelationError, corridorRouteOffset } from "./services/safetyDataService.js";
import { routeWeatherSchema, getCorrelatedRouteWeather } from "./services/weatherService.js";
import { claimEldOAuth, updateEldRevision } from './services/eldConcurrency.js';
import { operationalRouter } from './modules/admin/operational.routes.js';
import { auditTruck, isVerifiedTruck, publicTruck, saveTruck, verifyTruck } from "./modules/trucks/profileRevision.js";
import { rotateRefreshSession } from "./services/sessionRotation.js";
import { matchesSavedRoutingProfile } from "./modules/trucks/routingProfile.js";
import { createRateLimiter, requestMetadata, logServerEvent } from "./middleware/security.js";
import { truckSchema, truckUpdateSchema, routingTruckSchema } from "./modules/trucks/truck.schemas.js";
import { driverRecordScope, globalAnalyticsRoles } from "./modules/admin/driverAccessPolicy.js";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { disconnectDatabase, prisma } from "./lib/prisma.js";
import { isDatabaseUnavailableError } from "./lib/databaseErrors.js";
import { env } from "./config/env.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { signAccessToken } from "./utils/jwt.js";
import { hashPassword } from "./utils/password.js";
import { authenticatePassword } from './services/loginAuthentication.js';
import { requestPasswordRecovery } from './services/passwordRecovery.js';
import { createRecoveryQueue } from './services/recoveryQueue.js';
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

app.use(requestMetadata);
app.use(createRateLimiter(120, 60_000));
app.use("/auth", createRateLimiter(20, 60_000));

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

async function issueSession(user: any, db: Pick<typeof prisma, "refreshToken"> = prisma) {
  const refreshToken = issueRefreshToken();
  const session = await db.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.refreshTokenDays * 86_400_000),
    },
  });
  const accessToken = signAccessToken({ userId: user.id, email: user.email, role: user.role, sessionId: session.id });
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
    contracts: { truckProfileVerification: 'revision-v1', revocableAccessSessions: true },
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
  const input = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) }).parse(req.body);
  const user = await authenticatePassword(prisma, input.email, input.password);
  if (!user) {
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } });
  }
  res.json(await issueSession(user));
}));

app.post("/auth/refresh", asyncRoute(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(40).max(256) }).parse(req.body);
  const session = await rotateRefreshSession(prisma, hashToken(refreshToken), issueSession);
  if (!session) return res.status(401).json({ error: { code: "INVALID_REFRESH_TOKEN", message: "Session expired" } });
  res.json(session);
}));

// Possession of this opaque refresh credential authorizes revoking only that session.
// No user id or revoke-all operation is accepted. Works after access-token expiry.
app.post("/auth/logout", asyncRoute(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(40).max(256) }).strict().parse(req.body);
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  res.status(204).end();
}));

const enqueueRecovery = createRecoveryQueue(() => logServerEvent('RECOVERY_DELIVERY_FAILED'));
app.post("/auth/password-reset/request", asyncRoute(async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
  if (!env.recoveryEmail) {
    return res.status(503).json({ error: { code: 'RECOVERY_UNAVAILABLE', message: 'Password recovery is temporarily unavailable.' } });
  }
  const config = env.recoveryEmail;
  if (!enqueueRecovery(() => requestPasswordRecovery(prisma, config, email, () => logServerEvent('RECOVERY_DELIVERY_FAILED')))) {
    return res.status(503).json({ error: { code: 'RECOVERY_UNAVAILABLE', message: 'Password recovery is temporarily unavailable.' } });
  }
  res.status(202).json({ accepted: true });
}));

app.post("/auth/password-reset/confirm", asyncRoute(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(40), password: z.string().min(10).max(128) }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    return res.status(400).json({ error: { code: "INVALID_RESET_TOKEN", message: "Reset token is invalid or expired" } });
  }
  const passwordHash = await hashPassword(password);
  const consumed = await prisma.$transaction(async tx => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
  if (!consumed) return res.status(400).json({ error: { code: 'INVALID_RESET_TOKEN', message: 'Reset token is invalid or expired' } });
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


app.get('/trucks', requireAuth, asyncRoute(async (req,res)=>{
 const items=await prisma.truck.findMany({where:{userId:req.user!.userId},orderBy:[{isDefault:'desc'},{updatedAt:'desc'}]});res.json({items:items.map(publicTruck)});
}));
app.post('/trucks',requireAuth,asyncRoute(async(req,res)=>{z.object({createOperationId:z.string().uuid()}).parse(req.body);res.status(201).json(await saveTruck(prisma,req.user!.userId,req.user!.userId,req.body));}));
app.patch('/trucks/:id',requireAuth,asyncRoute(async(req,res)=>{
 const {expectedRevision}=z.object({expectedRevision:z.number().int().positive()}).parse(req.body);
 res.json(await saveTruck(prisma,req.user!.userId,req.user!.userId,req.body,String(req.params.id),expectedRevision));
}));
app.post('/trucks/:id/verify',requireAuth,asyncRoute(async(req,res)=>{
 const {expectedRevision}=z.object({expectedRevision:z.number().int().positive()}).strict().parse(req.body);
 res.json(await verifyTruck(prisma,req.user!.userId,String(req.params.id),expectedRevision));
}));
app.post('/trucks/:id/default',requireAuth,(_req,res)=>res.status(409).json({error:{code:'TRUCK_VERIFICATION_REQUIRED',message:'Review the current profile and confirm it using the updated app.'}}));
app.delete('/trucks/:id',requireAuth,asyncRoute(async(req,res)=>{
 const userId=req.user!.userId,id=String(req.params.id);
 await prisma.$transaction(async tx=>{
  const before=await tx.truck.findFirst({where:{id,userId}});
  if(!before)throw Object.assign(new Error('Truck unavailable'),{safeCode:'TRUCK_NOT_FOUND',safeStatus:404});
  if(await tx.truck.count({where:{userId}})<=1)throw Object.assign(new Error('Last truck'),{safeCode:'LAST_TRUCK',safeStatus:409});
  await auditTruck(tx,userId,'TRUCK_DELETED',before,before);await tx.truck.delete({where:{id}});
 },{isolationLevel:'Serializable'});res.status(204).end();
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
  truck: routingTruckSchema,
  routeMode: z.enum(["fastest", "fuel_optimized", "shortest"]).optional(),
  alternatives: z.number().int().min(0).max(5).optional(),
  avoidSegments: z.array(z.string().min(1)).max(250).optional(),
});
app.post("/routing/truck-route", requireAuth, asyncRoute(async (req, res) => {
  const input = routeSchema.extend({ truckProfileId: z.string().min(1).max(120), truckRevision: z.number().int().positive() }).parse(req.body);
  const where = { id: input.truckProfileId, userId: req.user!.userId, isDefault: true };
  const saved = await prisma.truck.findFirst({ where });
  if (!saved || !isVerifiedTruck(saved) || saved.revision !== input.truckRevision || !matchesSavedRoutingProfile(saved, input.truck)) return res.status(409).json({ error: { code: 'TRUCK_PROFILE_CHANGED', message: 'Refresh and verify the saved truck profile before routing.' } });
  const route = await buildTruckRoute({...input, truck:routingTruckSchema.parse(saved)});
  // An edit/default change during provider work invalidates the calculated result.
  const current = await prisma.truck.findFirst({ where });
  if (!current || !isVerifiedTruck(current) || current.revision !== saved.revision || current.updatedAt.getTime() !== saved.updatedAt.getTime() || !matchesSavedRoutingProfile(current, input.truck)) return res.status(409).json({ error: { code: 'TRUCK_PROFILE_CHANGED', message: 'Truck profile changed during routing. Review it again.' } });
  res.json(route);
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

app.post("/weather/route", requireAuth, asyncRoute(async (req, res) => {
  res.json({ items: await getCorrelatedRouteWeather(routeWeatherSchema.parse(req.body)) });
}));

const placeCategory = z.enum([
  "walmart_store",
  "weigh_station",
  "truck_stop",
  "rest_area",
  "fuel_stop",
  "truck_parking",
  "truck_wash",
  "cat_scale",
  "truck_repair",
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
    route: z.array(coordinate).min(2).max(20_000),
    currentLocation: coordinate.extend({accuracy: z.number().min(0).max(100), timestamp: z.number().finite()}).optional(),
    radiusMeters: z.number().int().min(100).max(100_000).optional(),
    maxResults: z.number().int().min(1).max(250).optional(),
  }).parse(req.body);
  const offset = corridorRouteOffset(input.route, input.currentLocation);
  const items = await searchHerePlacesAlongRoute({...input, currentRouteOffsetMeters: offset});
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
app.get("/admin/reports", requireAuth, requireRole(["ADMIN", "MODERATOR"]), asyncRoute(async (req, res) => {
  const status = req.query.status ? z.enum(["PENDING", "APPROVED", "REJECTED", "REMOVED", "EXPIRED"]).parse(req.query.status) : undefined;
  res.json({ items: await prisma.communityReport.findMany({ where: status ? { status: status as any } : {}, orderBy: { createdAt: "desc" }, take: 200 }) });
}));
app.patch("/admin/reports/:id", requireAuth, requireRole(["ADMIN", "MODERATOR"]), asyncRoute(async (req, res) => {
  const input = z.object({
    status: z.enum(["APPROVED", "REJECTED", "REMOVED", "EXPIRED"]),
    reason: z.string().min(3).max(500),
    duplicateOfId: z.string().nullable().optional(),
  }).parse(req.body);
  const report = await prisma.$transaction(async tx => {
    const updated = await tx.communityReport.update({ where: { id: String(req.params.id) }, data: { status: input.status, moderationReason: input.reason, duplicateOfId: input.duplicateOfId, moderatorId: req.user!.userId, moderatedAt: new Date() } });
    await tx.adminAuditLog.create({ data: { actorUserId: req.user!.userId, action: 'COMMUNITY_REPORT_MODERATED', targetType: 'COMMUNITY_REPORT', targetId: updated.id, metadataJson: { status: input.status, reason: input.reason } } });
    return updated;
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
  await prisma.$transaction(async tx=>{
  await tx.eldOAuthState.updateMany({where:{userId:req.user!.userId,provider,usedAt:null},data:{usedAt:new Date()}});
  const pending = await tx.eldConnection.upsert({
    where: { userId_provider: { userId: req.user!.userId, provider } },
    create: { userId: req.user!.userId, provider, status: "PENDING" },
    update: { revision:{increment:1}, status: "PENDING", lastErrorCode: null, lastErrorMessage: null },
  });
  await tx.eldOAuthState.create({
    data: {
      userId: req.user!.userId,
      provider,
      stateHash: hashToken(state),
      connectionRevision: pending.revision,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  },{isolationLevel:"Serializable"});
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
  const {connection}=await claimEldOAuth(prisma,hashToken(state),provider);
  const tokens=await exchangeAuthorizationCode(provider,code);
  await updateEldRevision(prisma,connection,{encryptedAccessToken:encryptSecret(tokens.accessToken),encryptedRefreshToken:tokens.refreshToken?encryptSecret(tokens.refreshToken):null,accessTokenExpiresAt:tokens.expiresAt,scopes:tokens.scopes,status:'CONNECTED',lastErrorCode:null,lastErrorMessage:null});
  res.json({ connected: true, provider });
}));

async function eldAccessToken(connection: any) {
  if (!connection.encryptedAccessToken) throw new Error("ELD connection has no access token");
  if (!connection.accessTokenExpiresAt || connection.accessTokenExpiresAt > new Date(Date.now() + 60_000)) {
    return decryptSecret(connection.encryptedAccessToken);
  }
  if (!connection.encryptedRefreshToken) throw new Error("ELD connection requires reauthorization");
  connection.revision=await updateEldRevision(prisma,connection,{});
  const tokens = await refreshProviderToken(connection.provider, decryptSecret(connection.encryptedRefreshToken));
  connection.revision=await updateEldRevision(prisma,connection,{encryptedAccessToken:encryptSecret(tokens.accessToken),encryptedRefreshToken:tokens.refreshToken?encryptSecret(tokens.refreshToken):connection.encryptedRefreshToken,accessTokenExpiresAt:tokens.expiresAt,scopes:tokens.scopes.length?tokens.scopes:connection.scopes,status:'CONNECTED'});
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
    connection.revision=await updateEldRevision(prisma,connection,{lastSyncedAt:syncedAt,lastErrorCode:null,lastErrorMessage:null,metadataJson:JSON.parse(JSON.stringify(normalized))});
    res.json({ ...normalized, syncedAt });
  } catch (error) {
    const message = "ELD sync failed. Reconnect the provider or try again.";
    await updateEldRevision(prisma,connection,{status:'ERROR',lastErrorCode:'SYNC_FAILED',lastErrorMessage:message}).catch(()=>undefined);
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
  await prisma.$transaction(async tx=>{
    await tx.eldOAuthState.updateMany({where:{userId:req.user!.userId,provider,usedAt:null},data:{usedAt:new Date()}});
    await tx.eldConnection.updateMany({where:{userId:req.user!.userId,provider},data:{revision:{increment:1},encryptedAccessToken:null,encryptedRefreshToken:null,accessTokenExpiresAt:null,status:'DISCONNECTED',scopes:[],metadataJson:{}}});
  },{isolationLevel:'Serializable'});
  if(connection?.encryptedRefreshToken){try{await revokeProviderToken(provider,decryptSecret(connection.encryptedRefreshToken));}catch{logServerEvent('ELD_REVOKE_FAILED');}}
  res.status(204).end();
}));

app.get("/admin/overview", requireAuth, requireRole(globalAnalyticsRoles), asyncRoute(async (_req, res) => {
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
  const role = req.query.role === undefined ? undefined : z.enum(["DRIVER", "ADMIN", "FLEET_ADMIN", "MODERATOR"]).parse(req.query.role);
  const where = { AND: [
    driverRecordScope(req.user!),
    ...(role ? [{ role }] : []),
    ...(search ? [{ OR: [
      { email: { contains: search, mode: "insensitive" as const } },
      { fullName: { contains: search, mode: "insensitive" as const } },
    ] }] : []),
  ] };
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

  if (targetId === req.user!.userId && (input.disabled === true || (input.role && input.role !== "ADMIN"))) {
    return res.status(409).json({ error: { code: "SELF_LOCKOUT_BLOCKED", message: "Administrators cannot disable or demote their own account" } });
  }
  const updated = await prisma.$transaction(async tx => {
  // Recheck actor authorization and the last-admin invariant inside the same serializable transaction.
  const actor = await tx.user.findUnique({ where: { id: req.user!.userId } });
  if (!actor || actor.role !== 'ADMIN' || actor.disabledAt) throw Object.assign(new Error('Access changed'), { safeCode: 'ACCESS_CHANGED', safeStatus: 403 });
  const current = await tx.user.findUnique({ where: { id: targetId } });
  if (!current) {
    throw Object.assign(new Error('User unavailable'), { safeCode: 'USER_NOT_FOUND', safeStatus: 404 });
  }
  if (current.role === "ADMIN" && (input.disabled === true || (input.role && input.role !== "ADMIN"))) {
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", disabledAt: null } });
    if (activeAdminCount <= 1) {
      throw Object.assign(new Error('Last administrator'), { safeCode: 'LAST_ADMIN_BLOCKED', safeStatus: 409 });
    }
  }

  const disabledAt = input.disabled === undefined
    ? current.disabledAt
    : input.disabled ? new Date() : null;
  const updated = await tx.user.update({
      where: { id: targetId },
      data: { role: input.role, disabledAt },
      select: { id: true, fullName: true, email: true, role: true, plan: true, emailVerified: true, disabledAt: true, updatedAt: true },
    });
    await tx.adminAuditLog.create({
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
    });
  if (input.role !== undefined || input.disabled === true) await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
  return updated;
  }, { isolationLevel: "Serializable" });
  res.json(updated);
}));

app.get("/admin/subscriptions", requireBillingEnabled, requireAuth, requireRole(["ADMIN"]), asyncRoute(async (req, res) => {
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
app.use("/admin/operations", operationalRouter);
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
  if (error instanceof CorridorCorrelationError) return res.status(error.httpStatus).json({error: {code: error.code, message: error.message}});
  const safe = error as { safeCode?: string; safeStatus?: number; code?: string } | null;
  if (safe?.safeCode && ['ACCESS_CHANGED','USER_NOT_FOUND','LAST_ADMIN_BLOCKED','TRUCK_NOT_FOUND','LAST_TRUCK','FORBIDDEN','DRIVER_NOT_FOUND','RECORD_NOT_FOUND','RECORD_CHANGED','TRUCK_PROFILE_CHANGED','INVALID_OAUTH_STATE','ELD_CONNECTION_CHANGED'].includes(safe.safeCode)) return res.status(safe.safeStatus ?? 409).json({ error: { code: safe.safeCode, message: 'This action could not be completed. Refresh and review the account.' } });
  if (safe?.code === 'P2034') return res.status(409).json({ error: { code: 'CONCURRENT_CHANGE', message: 'Information changed. Refresh and review before trying again.' } });
  if (safe?.code === 'P2002') return res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'This record already exists.' } });
  const transportError = error as { type?: string } | null;
  if (transportError?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } });
  if (transportError?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.' } });
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: { fieldErrors: Object.fromEntries(Object.keys(error.flatten().fieldErrors).map(key => [key, ["Invalid value"]])) } } });
  }
  if (error instanceof BillingFoundationError) {
    return res.status(error.httpStatus).json({
      error: { code: error.code, message: error.message },
    });
  }
  if (isDatabaseUnavailableError(error)) {
    logServerEvent("DATABASE_UNAVAILABLE");
    return res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "SemiTraX account services are temporarily unavailable. Please try again shortly.",
        retryable: true,
      },
    });
  }
  if (error instanceof RoutingProviderError) {
    logServerEvent("PROVIDER_FAILURE");
    void prisma.$executeRawUnsafe(
      `INSERT INTO "ApiErrorLog" (id, route, method, "statusCode", "errorCode", "occurredAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
      crypto.randomUUID(), _req.path.slice(0, 300), _req.method.slice(0, 12), error.httpStatus, error.code.slice(0, 120),
    ).catch(() => undefined);
    return res.status(error.httpStatus).json({
      truckSafe: error.truckSafe,
      navigationAllowed: error.navigationAllowed,
      error: {
        code: error.code,
        message: error.message,
        provider: error.provider,
        retryable: error.retryable,
      },
    });
  }
  logServerEvent("INTERNAL_ERROR");
  void prisma.$executeRawUnsafe(
    `INSERT INTO "ApiErrorLog" (id, route, method, "statusCode", "errorCode", "occurredAt") VALUES ($1,$2,$3,500,$4,NOW())`,
    crypto.randomUUID(), _req.path.slice(0, 300), _req.method.slice(0, 12), error instanceof Error ? error.name.slice(0, 120) : "UNKNOWN",
  ).catch(() => undefined);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
});

const server = app.listen(env.port, env.nodeEnv === "test" ? "127.0.0.1" : "0.0.0.0", () => {
  console.info(`SemiTrack API listening on port ${env.port}`);
});

const dotSyncTimer = setInterval(() => {
  void refreshDotProviders().catch((error) =>
    logServerEvent("DOT_REFRESH_FAILED"),
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
