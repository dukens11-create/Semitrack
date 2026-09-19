import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthTokenPayload = {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
  type?: "access";
};

export function signAccessToken(payload: Omit<AuthTokenPayload, "type">) {
  return jwt.sign({ ...payload, type: "access" }, env.jwtSecret, {
    expiresIn: `${env.accessTokenMinutes}m`,
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as AuthTokenPayload;
  if (!payload || typeof payload !== "object" || typeof payload.userId !== "string" || !payload.userId || typeof payload.email !== "string" || typeof payload.role !== "string") throw new Error("Invalid token claims");
  if (typeof payload.sessionId !== "string" || !payload.sessionId) throw new Error("Revocable session required");
  if (payload.type !== "access") throw new Error("Incorrect token type");
  return payload;
}

/** Kept for compatibility with older callers while they migrate. */
export const signToken = signAccessToken;
