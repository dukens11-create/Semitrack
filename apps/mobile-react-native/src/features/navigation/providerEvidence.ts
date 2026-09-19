/** Display gate for timestamped provider observations; absence is never interpreted as current. */
export function currentObservation(
  item: Record<string, unknown>,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  const source = item.source ?? item.provider;
  const observed = Date.parse(
    String(
      item.observedAt ??
        item.lastReportedAt ??
        item.lastUpdated ??
        item.updatedAt ??
        '',
    ),
  );
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    item.stale === true ||
    !Number.isFinite(observed) ||
    observed > now ||
    now - observed > maxAgeMs
  )
    return false;
  for (const key of ['expiresAt', 'endsAt'])
    if (item[key] !== undefined && item[key] !== null) {
      const expiry = Date.parse(String(item[key]));
      if (!Number.isFinite(expiry) || expiry <= now) return false;
    }
  if (item.startsAt !== undefined && item.startsAt !== null) {
    const start = Date.parse(String(item.startsAt));
    if (!Number.isFinite(start) || start > now) return false;
  }
  return true;
}
export function currentDieselPrice(
  item: Record<string, unknown>,
  now = Date.now(),
): boolean {
  return (
    item.verified === true &&
    item.fuelType === 'DIESEL' &&
    item.currency === 'USD' &&
    item.unit === 'US_GALLON' &&
    Number.isFinite(Date.parse(String(item.expiresAt))) &&
    currentObservation(item, 86400000, now)
  );
}
