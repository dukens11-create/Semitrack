import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { isAllowedStripeWebOrigin } from "../../config/billingConfig.js";

function sendBillingDisabled(res: Response) {
  res.setHeader("cache-control", "no-store");
  return res.status(503).json({
    error: {
      code: "BILLING_DISABLED",
      message: "Semi-Trax billing is currently disabled.",
      retryable: false,
    },
  });
}

export function requireBillingEnabled(_req: Request, res: Response, next: NextFunction) {
  if (env.billingMode === "disabled") return sendBillingDisabled(res);
  return next();
}

export function requireTestBillingMode(_req: Request, res: Response, next: NextFunction) {
  if (env.billingMode !== "test") return sendBillingDisabled(res);
  return next();
}

export function requireAllowedStripeWebOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");
  if (!isAllowedStripeWebOrigin(origin, env.stripeAllowedWebOrigins)) {
    res.setHeader("cache-control", "no-store");
    return res.status(403).json({
      error: {
        code: "BILLING_ORIGIN_NOT_ALLOWED",
        message: "This web origin is not allowed to access Semi-Trax billing.",
      },
    });
  }
  return next();
}
