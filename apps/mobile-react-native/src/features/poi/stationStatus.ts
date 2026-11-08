import { currentObservation } from '../navigation/providerEvidence';
/** Conservative local display expiry; never reinterpret missing/community data as official. */
export function stationStatus(raw: unknown, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return 'UNKNOWN';
  const value = raw as Record<string, unknown>;
  return value.stale === false &&
    ['OFFICIAL_LIVE', 'COMMUNITY'].includes(String(value.source)) &&
    currentObservation({ ...value, observedAt: value.lastReportedAt }, 15 * 60000, now) &&
    ['OPEN', 'CLOSED', 'INSPECTION'].includes(String(value.value))
    ? String(value.value)
    : 'UNKNOWN';
}
