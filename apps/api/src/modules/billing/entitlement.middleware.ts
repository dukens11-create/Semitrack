import type { NextFunction, Request, Response } from "express";
import type { EntitlementCode } from "@prisma/client";
import { getEffectiveEntitlementForUser } from "./entitlement.service.js";

export function requireEntitlement(entitlementCode: EntitlementCode) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    void getEffectiveEntitlementForUser(req.user.userId, entitlementCode)
      .then((entitlement) => {
        if (entitlement.status !== "ACTIVE") {
          res.status(403).json({
            error: {
              code: "PREMIUM_ENTITLEMENT_REQUIRED",
              message: "An active Semi-Trax premium entitlement is required.",
            },
          });
          return;
        }
        next();
      })
      .catch(next);
  };
}
