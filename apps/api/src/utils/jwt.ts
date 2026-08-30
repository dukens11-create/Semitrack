import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthTokenPayload = {
  userId: string;
  email: string;
  role: string;
  type?: "access";
};

export function signAccessToken(payload: Omit<AuthTokenPayload, "type">) {
  return jwt.sign({ ...payload, type: "access" }, env.jwtSecret, {
    expiresIn: `${env.accessTokenMinutes}m`,
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
  if (payload.type !== "access") throw new Error("Incorrect token type");
  return payload;
}

/** Kept for compatibility with older callers while they migrate. */
export const signToken = signAccessToken;
