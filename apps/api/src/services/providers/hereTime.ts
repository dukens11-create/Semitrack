/** Returns the RFC 3339 timestamp required by HERE Routing v8. */
export function hereDepartureTime(now = new Date()): string {
  return now.toISOString();
}
