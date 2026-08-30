import crypto from "node:crypto";
import { env } from "../config/env.js";
export { normalizeEldSnapshot } from "./eldNormalization.js";

export type EldProviderName = "SAMSARA" | "MOTIVE";

type ProviderConfig = {
  tokenUrl: string;
  apiBase: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  driversPath: string;
  vehiclesPath: string;
  hosPath: string;
};

export function eldConfig(provider: EldProviderName): ProviderConfig {
  return provider === "SAMSARA"
    ? {
        tokenUrl: "https://api.samsara.com/oauth2/token",
        apiBase: "https://api.samsara.com",
        clientId: env.samsaraClientId,
        clientSecret: env.samsaraClientSecret,
        redirectUri: env.samsaraRedirectUri,
        driversPath: "/fleet/drivers",
        vehiclesPath: "/fleet/vehicles",
        hosPath: "/fleet/hos/clocks",
      }
    : {
        tokenUrl: "https://gomotive.com/oauth/token",
        apiBase: "https://api.gomotive.com",
        clientId: env.motiveClientId,
        clientSecret: env.motiveClientSecret,
        redirectUri: env.motiveRedirectUri,
        driversPath: "/v1/users",
        vehiclesPath: "/v1/vehicles",
        hosPath: `/v1/hours_of_service?start_date=${new Date().toISOString().slice(0, 10)}`,
      };
}

function encryptionKey() {
  if (env.eldEncryptionKey.length < 32) {
    throw new Error("ELD_ENCRYPTION_KEY must be configured with at least 32 characters");
  }
  return crypto.createHash("sha256").update(env.eldEncryptionKey).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid encrypted ELD token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function tokenRequest(provider: EldProviderName, values: Record<string, string>) {
  const config = eldConfig(provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const credentials: Record<string, string> = provider === "SAMSARA"
    ? {}
    : { client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri };
  if (provider === "SAMSARA") {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      ...credentials,
      ...values,
    }),
  });
  const json: any = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`${provider} token exchange failed (${response.status})`);
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
    scopes: String(json.scope ?? "").split(/[ ,]+/).filter(Boolean),
  };
}

export async function revokeProviderToken(provider: EldProviderName, refreshToken: string) {
  if (provider !== "SAMSARA") return false;
  const config = eldConfig(provider);
  const response = await fetch("https://api.samsara.com/oauth2/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SAMSARA token revocation failed (${response.status})`);
  return true;
}

export function exchangeAuthorizationCode(provider: EldProviderName, code: string) {
  return tokenRequest(provider, { grant_type: "authorization_code", code });
}

export function refreshProviderToken(provider: EldProviderName, refreshToken: string) {
  return tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function eldGet(provider: EldProviderName, accessToken: string, path: string) {
  const config = eldConfig(provider);
  const response = await fetch(`${config.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${provider} API request failed (${response.status})`);
  return response.json();
}
