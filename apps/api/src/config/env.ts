import dotenv from "dotenv";
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? "";
if (nodeEnv === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}

const routingProvider = (process.env.ROUTING_PROVIDER ?? "here").trim().toLowerCase();
if (!new Set(["here", "trimble"]).has(routingProvider)) {
  throw new Error("ROUTING_PROVIDER must be either 'here' or 'trimble'");
}

const parseBoolean = (value: string | undefined, fallback = false) => {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
};

const dotProviderConfigJson = process.env.DOT_PROVIDER_CONFIG_JSON ?? "[]";
let dotProviderConfigured = false;
try {
  const parsed = JSON.parse(dotProviderConfigJson);
  dotProviderConfigured = Array.isArray(parsed) && parsed.length > 0;
} catch {
  // Provider parsing reports the actionable configuration error when refreshed.
}

export const env = {
  nodeEnv,
  appVersion: process.env.APP_VERSION ?? "1.0.0",
  appBuildSha: process.env.APP_BUILD_SHA ?? "",
  analyticsPresenceMinutes: Number(process.env.ANALYTICS_PRESENCE_MINUTES ?? 5),
  analyticsNavigationStaleMinutes: Number(process.env.ANALYTICS_NAVIGATION_STALE_MINUTES ?? 2),
  analyticsDrivingThresholdMinutes: Number(process.env.ANALYTICS_DRIVING_THRESHOLD_MINUTES ?? 660),
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: jwtSecret || "development-only-change-before-production",
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_MINUTES ?? 15),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 30),
  hereApiKey: process.env.HERE_API_KEY ?? "",
  mapboxToken: process.env.MAPBOX_TOKEN ?? "",
  routingProvider: routingProvider as "here" | "trimble",
  routingCompareEnabled: parseBoolean(process.env.ROUTING_COMPARE_ENABLED),
  trimbleApiKey: process.env.TRIMBLE_API_KEY ?? "",
  trimbleBaseUrl: process.env.TRIMBLE_BASE_URL ?? "https://pcmiler.alk.com/apis/rest/v1.0/Service.svc",
  trimbleDataVersion: process.env.TRIMBLE_DATA_VERSION ?? "Current",
  trimbleProfileName: process.env.TRIMBLE_PROFILE_NAME?.trim() ?? "",
  trimbleGeoTunnelIntervalMiles: Number(process.env.TRIMBLE_GEOTUNNEL_INTERVAL_MILES ?? 0.1),
  trimbleRequestTimeoutMs: Number(process.env.TRIMBLE_REQUEST_TIMEOUT_MS ?? 15_000),
  trimbleRoutePathEnabled: parseBoolean(process.env.TRIMBLE_ROUTE_PATH_ENABLED),
  trimbleAlternateRoutesEnabled: parseBoolean(process.env.TRIMBLE_ALTERNATE_ROUTES_ENABLED),
  dotProviderConfigJson,
  dotProviderConfigured,
  overpassApiUrl: process.env.OVERPASS_API_URL ?? "https://overpass-api.de/api/interpreter",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  passwordResetBaseUrl: process.env.PASSWORD_RESET_BASE_URL ?? "",
  eldEncryptionKey: process.env.ELD_ENCRYPTION_KEY ?? "",
  samsaraClientId: process.env.SAMSARA_CLIENT_ID ?? "",
  samsaraClientSecret: process.env.SAMSARA_CLIENT_SECRET ?? "",
  samsaraRedirectUri: process.env.SAMSARA_REDIRECT_URI ?? "",
  motiveClientId: process.env.MOTIVE_CLIENT_ID ?? "",
  motiveClientSecret: process.env.MOTIVE_CLIENT_SECRET ?? "",
  motiveRedirectUri: process.env.MOTIVE_REDIRECT_URI ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  awsRegion: process.env.AWS_REGION ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
};
