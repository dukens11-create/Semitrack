import { stationStatus } from '../src/features/poi/stationStatus';
const now = Date.now();
const base = { value: 'OPEN', source: 'OFFICIAL_LIVE', stale: false, lastReportedAt: new Date(now - 1000).toISOString() };
test.each([
  { expiresAt: new Date(now).toISOString() },
  { expiresAt: 'invalid' },
  { endsAt: new Date(now - 1).toISOString() },
  { startsAt: new Date(now + 1).toISOString() },
])('weigh-station validity window is respected: %p', invalid => {
  expect(stationStatus({ ...base, ...invalid }, now)).toBe('UNKNOWN');
});
test('valid station evidence and legacy reports without explicit expiry retain age checks', () => {
  expect(stationStatus(base, now)).toBe('OPEN');
  expect(stationStatus({ ...base, expiresAt: new Date(now + 1000).toISOString() }, now)).toBe('OPEN');
  expect(stationStatus(base, now + 900001)).toBe('UNKNOWN');
});
