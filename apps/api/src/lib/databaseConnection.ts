export function secureDatabaseConnectionString(raw: string): string {
  if (!raw.trim()) return raw;

  try {
    const url = new URL(raw);
    if (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname.toLowerCase().endsWith(".neon.tech")
    ) {
      url.searchParams.set("sslmode", "verify-full");
      url.searchParams.set("channel_binding", "require");
    }
    return url.toString();
  } catch {
    // Prisma/pg will return the actionable connection-string error.
    return raw;
  }
}
