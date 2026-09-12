import { isIP } from "node:net";

export type ProductionEnvironment = Record<string, string | undefined>;

function required(source: ProductionEnvironment, name: string) {
  const value = source[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required when NODE_ENV=production`);
  return value;
}

function httpsOrigin(value: string, name: string) {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(`${name} must be a valid HTTPS origin`); }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      value !== parsed.origin || hostname.includes("*") || isIP(hostname) ||
      hostname.startsWith("[") || !hostname.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|invalid|example)$/.test(hostname)) {
    throw new Error(`${name} must be an exact public HTTPS origin without credentials, paths, queries, fragments, or wildcards`);
  }
}

export function validateProductionConfiguration(source: ProductionEnvironment) {
  if (source.RENDER === "true" && source.NODE_ENV !== "production") {
    throw new Error("NODE_ENV must be production on Render");
  }
  if (source.NODE_ENV !== "production") return;

  const databaseUrl = required(source, "DATABASE_URL");
  let database: URL;
  try { database = new URL(databaseUrl); }
  catch { throw new Error("DATABASE_URL must be a PostgreSQL connection URL in production"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname ||
      !database.username || !database.password || database.pathname.length < 2 || database.hash ||
      database.hostname.toLowerCase() === "host" ||
      database.password.toUpperCase() === "PASSWORD") {
    throw new Error("DATABASE_URL must contain the actual PostgreSQL host, database, and credentials in production");
  }

  const jwtSecret = required(source, "JWT_SECRET");
  if (jwtSecret.length < 32 || jwtSecret !== source.JWT_SECRET ||
      /^(?:replace[-_ ]|change[-_ ]?me|your[-_ ]|development[-_ ]|example[-_ ])/i.test(jwtSecret)) {
    throw new Error("JWT_SECRET must contain at least 32 random characters, without surrounding whitespace or an example value");
  }

  const accessTokenMinutes = Number(required(source, "ACCESS_TOKEN_MINUTES"));
  const refreshTokenDays = Number(required(source, "REFRESH_TOKEN_DAYS"));
  if (!Number.isSafeInteger(accessTokenMinutes) || accessTokenMinutes < 1) {
    throw new Error("ACCESS_TOKEN_MINUTES must be a positive safe integer in production");
  }
  if (!Number.isSafeInteger(refreshTokenDays) || refreshTokenDays < 1) {
    throw new Error("REFRESH_TOKEN_DAYS must be a positive safe integer in production");
  }
  if (source.PORT !== undefined && (!/^\d+$/.test(source.PORT) || Number(source.PORT) < 1 || Number(source.PORT) > 65535)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  httpsOrigin(required(source, "PUBLIC_API_URL"), "PUBLIC_API_URL");
  const origins = required(source, "CORS_ORIGINS").split(",").map((value) => value.trim());
  if (origins.some((origin) => !origin)) throw new Error("CORS_ORIGINS must list explicit HTTPS origins without empty entries");
  for (const origin of origins) httpsOrigin(origin, "CORS_ORIGINS");
}
