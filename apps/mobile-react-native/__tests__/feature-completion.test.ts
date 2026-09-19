import {
  currentObservation,
  currentDieselPrice,
} from '../src/features/navigation/providerEvidence';
import { WarningManager } from '../src/features/navigation/WarningManager';
import { interpolateVehicleFix } from '../src/features/map/vehicleDisplay';
import { shareRouteSummary } from '../src/features/navigation/shareRouteSummary';
import { recordLines } from '../src/features/dot511/CorridorRecords';
import { DestinationSearchStore } from '../src/features/search/DestinationSearchStore';
import type { SearchService } from '../src/features/search/SearchService';
import type { PoiService } from '../src/features/poi/PoiService';
import {
  LocationService,
  type LocationProvider,
} from '../src/services/location/LocationService';
import { route } from './fixtures';
const now = Date.now();
const observation = {
  source: 'authenticated fixture',
  observedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60000).toISOString(),
};
test.each([
  { ...observation, source: '' },
  { ...observation, observedAt: undefined },
  { ...observation, observedAt: 'invalid' },
  { ...observation, observedAt: new Date(now - 900001).toISOString() },
  { ...observation, observedAt: new Date(now + 1).toISOString() },
  { ...observation, expiresAt: 'invalid' },
  { ...observation, expiresAt: new Date(now).toISOString() },
  { ...observation, stale: true },
])('unproven or expired observation is not current: %j', item =>
  expect(currentObservation(item, 900000, now)).toBe(false),
);
test('fuel needs verified source, explicit comparable units and finite expiry', () => {
  const price = {
    ...observation,
    verified: true,
    fuelType: 'DIESEL',
    currency: 'USD',
    unit: 'US_GALLON',
    cashPrice: 4,
  };
  expect(currentDieselPrice(price, now)).toBe(true);
  for (const bad of [
    { ...price, verified: false },
    { ...price, expiresAt: 'invalid' },
    { ...price, unit: undefined },
    { ...price, source: undefined },
  ]) {
    expect(currentDieselPrice(bad, now)).toBe(false);
    expect(recordLines({ prices: [bad] }).join(' ')).not.toContain(
      'Cash diesel:',
    );
  }
  expect(
    recordLines({ currentAvailability: { value: 'OPEN', stale: false } }),
  ).toContain('Reported status: UNKNOWN');
});
test('warning refresh cannot extend old provider evidence or show expired reports', () => {
  const m = new WarningManager();
  const item = {
    ...observation,
    id: 'w',
    title: 'Closure',
    routeDistanceAheadMeters: 100,
    severity: 'HIGH',
    observedAt: new Date(now - 299000).toISOString(),
  };
  m.load([item], 0, now);
  expect(m.visible(0, now)).toHaveLength(1);
  expect(m.visible(0, now + 1001)).toEqual([]);
  m.load([{ ...item, observedAt: 'invalid' }], 0, now);
  expect(m.visible(0, now)).toEqual([]);
});
test('display movement interpolates only received fixes and takes shortest heading arc', () => {
  const a = {
    latitude: 40,
    longitude: -100,
    accuracy: 4,
    timestamp: now - 1000,
    speed: 10,
    heading: 350,
  };
  const b = {
    ...a,
    latitude: 40.001,
    longitude: -99.999,
    timestamp: now,
    heading: 10,
  };
  const half = interpolateVehicleFix(a, b, 0.5);
  expect(half.heading).toBe(0);
  expect(half.latitude).toBeCloseTo(40.0005);
  expect(interpolateVehicleFix(a, b, 2)).toEqual(b);
  expect(interpolateVehicleFix(a, b, -1).latitude).toBe(a.latitude);
  expect(interpolateVehicleFix(a, { ...a, timestamp: now }, 0.5).latitude).toBe(
    a.latitude,
  );
});
test('share summary uses actual plan and estimates without GPS or fabricated tracking', () => {
  const text = shareRouteSummary(route(), {
    stops: [],
    destination: {
      id: 'd',
      name: 'Customer depot',
      lat: 40.123456,
      lng: -100.123456,
    },
  });
  expect(text).toContain('Customer depot');
  expect(text).toContain('provider planning estimate');
  expect(text).toContain('Not live tracking');
  expect(text).not.toContain('40.123456');
  expect(text).not.toContain('-100.123456');
});
test('recent searches are successful session queries, bounded, deduplicated and clearable', async () => {
  const store = new DestinationSearchStore(
    { search: jest.fn().mockResolvedValue([]) } as unknown as SearchService,
    {} as PoiService,
  );
  for (const q of ['one', 'two', 'three', 'four', 'five', 'six', 'THREE']) {
    store.schedule(q);
    await store.searchNow();
  }
  expect(store.getSnapshot().recentQueries).toEqual([
    'THREE',
    'six',
    'five',
    'four',
    'two',
  ]);
  store.cancel();
  expect(store.getSnapshot().recentQueries).toHaveLength(5);
  store.clearRecent();
  expect(store.getSnapshot().recentQueries).toEqual([]);
});
test('native mock rejection is displayed safely and clears usable GPS', async () => {
  let fail: (message: string) => void = () => {};
  const provider: LocationProvider = {
    permissionStatus: async () => 'granted',
    permission: async () => 'granted',
    start: async () => {},
    stop: async () => {},
    subscribe: (_fix, error) => {
      fail = error;
      return () => {};
    },
  };
  const service = new LocationService(provider);
  await service.start();
  fail('Mock location is not accepted for truck routing.');
  expect(service.getFreshFix()).toBeNull();
  expect(service.getSnapshot().error).toContain('Mock or simulated');
  await service.stop();
});
