import { currentObservation } from '../navigation/providerEvidence';
export function parkingStatus(raw: unknown, now = Date.now()) {
  const unknown = { value: 'UNKNOWN', kind: 'Unknown' };
  if (!raw || typeof raw !== 'object') return unknown;
  const report = raw as Record<string, unknown>;
  if (report.stale !== false ||
      !['OFFICIAL_LIVE', 'COMMUNITY'].includes(String(report.source)) ||
      !['PLENTY', 'SOME', 'ALMOST_FULL', 'FULL'].includes(String(report.value)) ||
      !currentObservation(report, 900000, now)) return unknown;
  return { value: String(report.value), kind: report.source === 'COMMUNITY' ? 'Community estimate' : 'Provider report' };
}
