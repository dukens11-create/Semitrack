import { parkingStatus } from '../src/features/poi/parkingStatus';
import { recordLines } from '../src/features/dot511/CorridorRecords';
const now = Date.now();
const report = { value: 'SOME', source: 'OFFICIAL_LIVE', stale: false, lastReportedAt: new Date(now).toISOString() };
test('provider and community reports are distinctly labeled', () => {
  expect(parkingStatus(report, now)).toEqual({ value: 'SOME', kind: 'Provider report' });
  expect(parkingStatus({ ...report, source: 'COMMUNITY' }, now).kind).toBe('Community estimate');
  expect(recordLines({ currentAvailability: { ...report, source: 'COMMUNITY' } })).toContain('Availability type: Community estimate');
});
test.each([
  { source: 'UNKNOWN' }, { value: 'invented' }, { stale: true },
  { lastReportedAt: 'invalid' }, { lastReportedAt: new Date(now - 900001).toISOString() },
  { expiresAt: new Date(now).toISOString() },
])('invalid or expired parking remains unknown: %p', invalid => {
  expect(parkingStatus({ ...report, ...invalid }, now)).toEqual({ value: 'UNKNOWN', kind: 'Unknown' });
});
