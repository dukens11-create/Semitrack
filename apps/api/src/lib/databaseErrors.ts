import { Prisma } from "@prisma/client";

const unavailableCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1008",
  "P1011",
  "P2024",
]);

const unavailableMessagePatterns = [
  "error opening a tls connection",
  "can't reach database server",
  "connection terminated unexpectedly",
  "connection timeout",
  "connect etimedout",
  "connect econnrefused",
  "getaddrinfo enotfound",
  "no credentials are available in the security package",
];

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    unavailableCodes.has(error.code)
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return unavailableMessagePatterns.some((pattern) => normalized.includes(pattern));
}
