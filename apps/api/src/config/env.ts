import dotenv from "dotenv";
import { parseBillingConfiguration } from "./billingConfig.js";
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? "";
if (nodeEnv === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}

const routingProvider = (process.env.ROUTING_PROVIDER ?? "trimble").trim().toLowerCase();
if (!new Set(["here", "trimble"]).has(routingProvider)) {
  throw new Error("ROUTING_PROVIDER must be either 'here' or 'trimble'");
}

const parseBoolean = (value: string | undefined, fallback = false) => {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
};

const billing = parseBillingConfiguration(process.env);
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (corsOrigins.includes("*")) {
  throw new Error("CORS_ORIGINS must list exact origins; wildcard CORS is not allowed");
}

const positiveNumber = (name: string, fallback: number) => {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
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
  trimbleRoutePathEnabled: parseBoolean(process.env.TRIMBLE_ROUTE_PATH_ENABLED ?? "true"),
  trimbleAlternateRoutesEnabled: parseBoolean(process.env.TRIMBLE_ALTERNATE_ROUTES_ENABLED),
  dotProviderConfigJson,
  dotProviderConfigured,
  overpassApiUrl: process.env.OVERPASS_API_URL ?? "https://overpass-api.de/api/interpreter",
  billingMode: billing.mode,
  publicApiUrl: process.env.PUBLIC_API_URL?.trim() ?? "",
  googleRtdnWebhookUrl: process.env.GOOGLE_RTDN_WEBHOOK_URL?.trim() ?? "",
  appleNotificationsUrl: process.env.APPLE_NOTIFICATIONS_URL?.trim() ?? "",
  stripeWebhookUrl: process.env.STRIPE_WEBHOOK_URL?.trim() ?? "",
  googlePlayPackageName: process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() ?? "",
  googlePlaySubscriptionProductId: process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID?.trim() ?? "semitrax_premium",
  googlePlayMonthlyBasePlanId: process.env.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID?.trim() ?? "monthly",
  googlePlayAnnualBasePlanId: process.env.GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID?.trim() ?? "annual",
  googlePlayTrialOfferId: process.env.GOOGLE_PLAY_TRIAL_OFFER_ID?.trim() ?? "trial_7_day",
  appleBundleId: process.env.APPLE_BUNDLE_ID?.trim() ?? "",
  appleSubscriptionGroupName: process.env.APPLE_SUBSCRIPTION_GROUP_NAME?.trim() ?? "Semi-Trax Premium",
  appleMonthlyProductId: process.env.APPLE_MONTHLY_PRODUCT_ID?.trim() ?? "com.semitrax.premium.monthly",
  appleAnnualProductId: process.env.APPLE_ANNUAL_PRODUCT_ID?.trim() ?? "com.semitrax.premium.annual",
  pilotCampaignCode: process.env.PILOT_CAMPAIGN_CODE?.trim() ?? "FOUNDING_100",
  pilotMaxRedemptions: billing.pilotMaxRedemptions,
  pilotDiscountMonths: billing.pilotDiscountMonths,
  pilotReservationMinutes: billing.pilotReservationMinutes,
  entitlementOfflineCacheHours: positiveNumber("ENTITLEMENT_OFFLINE_CACHE_HOURS", 24),
  entitlementNegativeCacheMinutes: positiveNumber("ENTITLEMENT_NEGATIVE_CACHE_MINUTES", 5),
  websiteUrl: process.env.WEBSITE_URL?.trim() ?? "https://www.semitrax.com",
  privacyPolicyUrl: process.env.PRIVACY_POLICY_URL?.trim() ?? "https://www.semitrax.com/privacy.html",
  termsOfServiceUrl: process.env.TERMS_OF_SERVICE_URL?.trim() ?? "https://www.semitrax.com/terms.html",
  supportEmail: process.env.SUPPORT_EMAIL?.trim() ?? "contact@semitrax.com",
  temporaryWebsiteFallback: process.env.TEMPORARY_WEBSITE_FALLBACK?.trim() ?? "https://semitrax-website.onrender.com",
  fleetSalesEmail: process.env.FLEET_SALES_EMAIL?.trim() ?? "contact@semitrax.com",
  fleetContactUrl: process.env.FLEET_CONTACT_URL?.trim() ?? "https://www.semitrax.com/#contact",
  fleetContactFallbackMailto: process.env.FLEET_CONTACT_FALLBACK_MAILTO?.trim()
    ?? "mailto:contact@semitrax.com?subject=Semi-Trax%20Fleet%20Subscription",
  stripeSecretKey: billing.stripeSecretKey,
  stripeWebhookSecret: billing.stripeWebhookSecret,
  stripeTrialDays: billing.stripeTrialDays,
  stripeGracePeriodDays: billing.stripeGracePeriodDays,
  stripeAutomaticTaxEnabled: billing.stripeAutomaticTaxEnabled,
  stripeAllowedWebOrigins: billing.stripeAllowedWebOrigins,
  stripeCheckoutSuccessUrl: billing.stripeCheckoutSuccessUrl,
  stripeCheckoutCancelUrl: billing.stripeCheckoutCancelUrl,
  stripePortalReturnUrl: billing.stripePortalReturnUrl,
  passwordResetBaseUrl: process.env.PASSWORD_RESET_BASE_URL ?? "",
  eldEncryptionKey: process.env.ELD_ENCRYPTION_KEY ?? "",
  samsaraClientId: process.env.SAMSARA_CLIENT_ID ?? "",
  samsaraClientSecret: process.env.SAMSARA_CLIENT_SECRET ?? "",
  samsaraRedirectUri: process.env.SAMSARA_REDIRECT_URI ?? "",
  motiveClientId: process.env.MOTIVE_CLIENT_ID ?? "",
  motiveClientSecret: process.env.MOTIVE_CLIENT_SECRET ?? "",
  motiveRedirectUri: process.env.MOTIVE_REDIRECT_URI ?? "",
  corsOrigins,
  awsRegion: process.env.AWS_REGION ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
};
