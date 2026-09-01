export type BillingMode = "disabled" | "test";

export class BillingConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`);
    this.variable = variable;
    this.name = "BillingConfigurationError";
  }
}

function rawValue(source: NodeJS.ProcessEnv, name: string) {
  return source[name]?.trim() ?? "";
}

function parseInteger(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
) {
  const raw = rawValue(source, name);
  const parsed = raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    const rule = minimum === 0 ? "an integer greater than or equal to 0" : `an integer greater than or equal to ${minimum}`;
    throw new BillingConfigurationError(name, `must be ${rule}`);
  }
  return parsed;
}

function parseBoolean(source: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const raw = rawValue(source, name);
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new BillingConfigurationError(name, "must be 'true' or 'false'");
}

function parseExactHttpsOrigin(value: string) {
  if (value === "*") {
    throw new BillingConfigurationError("STRIPE_ALLOWED_WEB_ORIGINS", "wildcard origins are not allowed");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BillingConfigurationError("STRIPE_ALLOWED_WEB_ORIGINS", "contains an invalid origin");
  }
  if (parsed.protocol !== "https:") {
    throw new BillingConfigurationError("STRIPE_ALLOWED_WEB_ORIGINS", "origins must use HTTPS");
  }
  if (parsed.username || parsed.password || value !== parsed.origin) {
    throw new BillingConfigurationError(
      "STRIPE_ALLOWED_WEB_ORIGINS",
      "must contain exact origins without paths, queries, credentials, or trailing slashes",
    );
  }
  return parsed.origin;
}

export function parseExactOriginAllowlist(raw: string | undefined) {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return [...new Set(values.map(parseExactHttpsOrigin))];
}

function assertProductionHttpsUrl(name: string, value: string) {
  if (!value) throw new BillingConfigurationError(name, "is required when billing is enabled");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BillingConfigurationError(name, "must be a valid URL");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    throw new BillingConfigurationError(
      name,
      "must be a public HTTPS production URL without credentials or a fragment",
    );
  }
  return parsed.toString();
}

function requireEnabledValue(source: NodeJS.ProcessEnv, name: string) {
  const value = rawValue(source, name);
  if (!value) throw new BillingConfigurationError(name, "is required when billing is enabled");
  return value;
}

export function parseBillingConfiguration(source: NodeJS.ProcessEnv = process.env) {
  const rawMode = rawValue(source, "BILLING_MODE") || "disabled";
  if (rawMode !== "disabled" && rawMode !== "test") {
    throw new BillingConfigurationError(
      "BILLING_MODE",
      "must be 'disabled' or 'test' until production billing is explicitly approved",
    );
  }
  const mode = rawMode as BillingMode;
  const stripeTrialDays = parseInteger(source, "STRIPE_TRIAL_DAYS", 7, 0);
  const stripeGracePeriodDays = parseInteger(source, "STRIPE_GRACE_PERIOD_DAYS", 3, 0);
  const pilotMaxRedemptions = parseInteger(source, "PILOT_MAX_REDEMPTIONS", 100, 1);
  if (pilotMaxRedemptions > 100) {
    throw new BillingConfigurationError(
      "PILOT_MAX_REDEMPTIONS",
      "cannot exceed the approved Founding 100 campaign limit",
    );
  }
  const pilotDiscountMonths = parseInteger(source, "PILOT_DISCOUNT_MONTHS", 6, 1);
  const pilotReservationMinutes = parseInteger(source, "PILOT_RESERVATION_MINUTES", 10_080, 1);
  const stripeAutomaticTaxEnabled = parseBoolean(source, "STRIPE_AUTOMATIC_TAX_ENABLED", false);
  if (stripeAutomaticTaxEnabled) {
    throw new BillingConfigurationError(
      "STRIPE_AUTOMATIC_TAX_ENABLED",
      "must remain false until production tax registration and nexus obligations are approved",
    );
  }
  const stripeAllowedWebOrigins = parseExactOriginAllowlist(source.STRIPE_ALLOWED_WEB_ORIGINS);

  let stripeSecretKey = rawValue(source, "STRIPE_SECRET_KEY");
  let stripeWebhookSecret = rawValue(source, "STRIPE_WEBHOOK_SECRET");
  let stripeCheckoutSuccessUrl = rawValue(source, "STRIPE_CHECKOUT_SUCCESS_URL");
  let stripeCheckoutCancelUrl = rawValue(source, "STRIPE_CHECKOUT_CANCEL_URL");
  let stripePortalReturnUrl = rawValue(source, "STRIPE_PORTAL_RETURN_URL");

  if (mode !== "disabled") {
    stripeSecretKey = requireEnabledValue(source, "STRIPE_SECRET_KEY");
    stripeWebhookSecret = requireEnabledValue(source, "STRIPE_WEBHOOK_SECRET");
    if (stripeSecretKey.startsWith("sk_live_")) {
      throw new BillingConfigurationError("STRIPE_SECRET_KEY", "live Stripe keys are not allowed in test billing mode");
    }
    if (stripeAllowedWebOrigins.length === 0) {
      throw new BillingConfigurationError(
        "STRIPE_ALLOWED_WEB_ORIGINS",
        "must contain at least one exact HTTPS origin when billing is enabled",
      );
    }
    stripeCheckoutSuccessUrl = assertProductionHttpsUrl(
      "STRIPE_CHECKOUT_SUCCESS_URL",
      rawValue(source, "STRIPE_CHECKOUT_SUCCESS_URL"),
    );
    stripeCheckoutCancelUrl = assertProductionHttpsUrl(
      "STRIPE_CHECKOUT_CANCEL_URL",
      rawValue(source, "STRIPE_CHECKOUT_CANCEL_URL"),
    );
    stripePortalReturnUrl = assertProductionHttpsUrl(
      "STRIPE_PORTAL_RETURN_URL",
      rawValue(source, "STRIPE_PORTAL_RETURN_URL"),
    );
    for (const [name, value] of [
      ["STRIPE_CHECKOUT_SUCCESS_URL", stripeCheckoutSuccessUrl],
      ["STRIPE_CHECKOUT_CANCEL_URL", stripeCheckoutCancelUrl],
      ["STRIPE_PORTAL_RETURN_URL", stripePortalReturnUrl],
    ] as const) {
      if (!stripeAllowedWebOrigins.includes(new URL(value).origin)) {
        throw new BillingConfigurationError(name, "origin is not present in STRIPE_ALLOWED_WEB_ORIGINS");
      }
    }
  }

  return {
    mode,
    stripeSecretKey,
    stripeWebhookSecret,
    stripeTrialDays,
    stripeGracePeriodDays,
    stripeAutomaticTaxEnabled,
    stripeAllowedWebOrigins,
    stripeCheckoutSuccessUrl,
    stripeCheckoutCancelUrl,
    stripePortalReturnUrl,
    pilotMaxRedemptions,
    pilotDiscountMonths,
    pilotReservationMinutes,
  };
}

export function isAllowedStripeWebOrigin(origin: string | undefined, allowedOrigins: readonly string[]) {
  return Boolean(origin && allowedOrigins.includes(origin));
}
