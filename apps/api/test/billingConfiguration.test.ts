import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  BillingConfigurationError,
  isAllowedStripeWebOrigin,
  parseBillingConfiguration,
  parseExactOriginAllowlist,
} from "../src/config/billingConfig.ts";

const enabledConfiguration: NodeJS.ProcessEnv = {
  BILLING_MODE: "test",
  STRIPE_SECRET_KEY: "not-a-real-stripe-test-key",
  STRIPE_WEBHOOK_SECRET: "not-a-real-webhook-secret",
  STRIPE_ALLOWED_WEB_ORIGINS: "https://www.semitrax.com",
  STRIPE_CHECKOUT_SUCCESS_URL: "https://www.semitrax.com/billing/success",
  STRIPE_CHECKOUT_CANCEL_URL: "https://www.semitrax.com/billing/cancel",
  STRIPE_PORTAL_RETURN_URL: "https://www.semitrax.com/account/billing",
};

test("disabled billing accepts empty Stripe credentials and URLs", () => {
  const result = parseBillingConfiguration({ BILLING_MODE: "disabled" });
  assert.equal(result.mode, "disabled");
  assert.equal(result.stripeSecretKey, "");
  assert.equal(result.stripeWebhookSecret, "");
  assert.deepEqual(result.stripeAllowedWebOrigins, []);
  assert.equal(result.stripeAutomaticTaxEnabled, false);
});

test("Stripe Tax remains disabled throughout Phase 2", () => {
  assert.equal(
    parseBillingConfiguration({ BILLING_MODE: "disabled", STRIPE_AUTOMATIC_TAX_ENABLED: "false" })
      .stripeAutomaticTaxEnabled,
    false,
  );
  assert.throws(
    () => parseBillingConfiguration({ BILLING_MODE: "disabled", STRIPE_AUTOMATIC_TAX_ENABLED: "true" }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_AUTOMATIC_TAX_ENABLED",
  );
  assert.throws(
    () => parseBillingConfiguration({ BILLING_MODE: "disabled", STRIPE_AUTOMATIC_TAX_ENABLED: "yes" }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_AUTOMATIC_TAX_ENABLED",
  );
});

test("enabled billing rejects missing provider configuration", () => {
  assert.throws(
    () => parseBillingConfiguration({ BILLING_MODE: "test" }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_SECRET_KEY",
  );
  assert.throws(
    () => parseBillingConfiguration({ ...enabledConfiguration, STRIPE_ALLOWED_WEB_ORIGINS: "" }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_ALLOWED_WEB_ORIGINS",
  );
});

test("numeric billing configuration is validated at startup", () => {
  for (const [name, invalidValue] of [
    ["STRIPE_TRIAL_DAYS", "-1"],
    ["STRIPE_GRACE_PERIOD_DAYS", "-1"],
    ["PILOT_MAX_REDEMPTIONS", "0"],
    ["PILOT_DISCOUNT_MONTHS", "0"],
    ["PILOT_RESERVATION_MINUTES", "0"],
  ] as const) {
    assert.throws(
      () => parseBillingConfiguration({ BILLING_MODE: "disabled", [name]: invalidValue }),
      (error) => error instanceof BillingConfigurationError && error.variable === name,
      name,
    );
  }
  assert.equal(parseBillingConfiguration({ STRIPE_TRIAL_DAYS: "0" }).stripeTrialDays, 0);
  assert.equal(parseBillingConfiguration({ STRIPE_GRACE_PERIOD_DAYS: "0" }).stripeGracePeriodDays, 0);
  assert.throws(
    () => parseBillingConfiguration({ PILOT_MAX_REDEMPTIONS: "101" }),
    (error) => error instanceof BillingConfigurationError && error.variable === "PILOT_MAX_REDEMPTIONS",
  );
});

test("Stripe web origins are a canonical exact-origin allowlist", () => {
  assert.deepEqual(
    parseExactOriginAllowlist("https://www.semitrax.com,https://fleet.semitrax.com,https://www.semitrax.com"),
    ["https://www.semitrax.com", "https://fleet.semitrax.com"],
  );
  assert.throws(() => parseExactOriginAllowlist("*"), BillingConfigurationError);
  assert.throws(() => parseExactOriginAllowlist("https://www.semitrax.com/"), BillingConfigurationError);
  assert.throws(() => parseExactOriginAllowlist("https://www.semitrax.com/billing"), BillingConfigurationError);
});

test("disallowed Stripe web origins never match by prefix or wildcard", () => {
  const allowed = ["https://www.semitrax.com"];
  assert.equal(isAllowedStripeWebOrigin("https://www.semitrax.com", allowed), true);
  assert.equal(isAllowedStripeWebOrigin("https://www.semitrax.com.evil.example", allowed), false);
  assert.equal(isAllowedStripeWebOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedStripeWebOrigin(undefined, allowed), false);
});

test("enabled billing requires public HTTPS destinations on an allowed origin", () => {
  assert.throws(
    () => parseBillingConfiguration({
      ...enabledConfiguration,
      STRIPE_CHECKOUT_SUCCESS_URL: "http://www.semitrax.com/billing/success",
    }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_CHECKOUT_SUCCESS_URL",
  );
  assert.throws(
    () => parseBillingConfiguration({
      ...enabledConfiguration,
      STRIPE_PORTAL_RETURN_URL: "https://account.example.com/billing",
    }),
    (error) => error instanceof BillingConfigurationError && error.variable === "STRIPE_PORTAL_RETURN_URL",
  );
  assert.equal(parseBillingConfiguration(enabledConfiguration).mode, "test");
});

test("billing endpoint attempts return BILLING_DISABLED while disabled", async () => {
  process.env.BILLING_MODE = "disabled";
  const { requireBillingEnabled } = await import("../dist/modules/billing/billingMode.middleware.js");
  const app = express();
  const billingPaths = [
    "/subscription-plans",
    "/entitlements",
    "/pilot",
    "/admin/subscriptions",
    "/billing",
  ];
  for (const path of billingPaths) {
    app.use(path, requireBillingEnabled, (_req, res) => res.json({ unexpected: true }));
  }
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const path of billingPaths) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 503, path);
      const body = await response.json() as { error?: { code?: string; retryable?: boolean } };
      assert.equal(body.error?.code, "BILLING_DISABLED", path);
      assert.equal(body.error?.retryable, false, path);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
