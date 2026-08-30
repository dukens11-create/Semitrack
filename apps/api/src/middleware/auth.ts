import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../utils/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  try {
    const token = auth.replace("Bearer ", "");
    const claims = verifyToken(token);
    // Revalidate current account state on every protected request. A role
    // demotion or suspension must take effect immediately rather than waiting
    // for an already-issued access token to expire.
    void prisma.user
      .findUnique({
        where: { id: claims.userId },
        select: { id: true, email: true, role: true, disabledAt: true },
      })
      .then(async (user) => {
        if (!user || user.disabledAt) {
          res.status(401).json({ error: "Account unavailable" });
          return;
        }
        req.user = {
          userId: user.id,
          email: user.email,
          role: user.role,
        };
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "lastActivityAt" = NOW()
           WHERE id = $1 AND ("lastActivityAt" IS NULL OR "lastActivityAt" < NOW() - interval '60 seconds')`,
          user.id,
        );
        next();
      })
      .catch(next);
    return;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}
