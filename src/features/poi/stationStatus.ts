/** Conservative local display expiry; never reinterpret missing/community data as official. */
export function stationStatus(raw: unknown, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return 'UNKNOWN';
  const value = raw as Record<string, unknown>;
  const age = now - Date.parse(String(value.lastReportedAt));
  return value.stale === false &&
    ['OFFICIAL_LIVE', 'COMMUNITY'].includes(String(value.source)) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 15 * 60000 &&
    ['OPEN', 'CLOSED', 'INSPECTION'].includes(String(value.value))
    ? String(value.value)
    : 'UNKNOWN';
}
