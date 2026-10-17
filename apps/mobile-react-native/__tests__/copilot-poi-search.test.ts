import {
  CoPilotPoiSearch,
  nativePlaceQueries,
  nativePoisAhead,
} from '../src/services/copilot/CoPilotPoiSearch';
import { placeCategories, PoiService } from '../src/features/poi/PoiService';
const mockHost = { searchNativePois: jest.fn() };
const mockCatalog = jest.fn();
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => mockHost,
}));
jest.mock('../src/services/copilot/CoPilotPlaces', () => ({
  readCoPilotPlaces: () => mockCatalog(),
}));
const point = { lat: 40, lng: -120 };
const poi = (name: string, latitude = 40.01, longitude = -120) => ({
  id: name,
  name,
  latitude,
  longitude,
  provider: 'copilot',
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCatalog.mockResolvedValue([]);
  mockHost.searchNativePois.mockResolvedValue([]);
});
test('every existing place category has an offline search path', async () => {
  const search = new CoPilotPoiSearch();
  for (const category of placeCategories) {
    await search.nearby(category, point);
    expect(mockHost.searchNativePois).toHaveBeenLastCalledWith(
      nativePlaceQueries[category].query,
      [],
      40,
      -120,
    );
  }
});
test('native IDs are discovered instead of hardcoded and real results reach PoiService', async () => {
  mockCatalog.mockResolvedValue([
    { id: 987, name: 'Truck Stops', visible: false },
  ]);
  mockHost.searchNativePois.mockResolvedValue([poi('Pilot Travel Center')]);
  const api = { request: jest.fn() };
  const service = new PoiService(api as never, new CoPilotPoiSearch());
  const results = await service.nearby('truck_stop', point);
  expect(mockHost.searchNativePois).toHaveBeenCalledWith('', [987], 40, -120);
  expect(results[0]).toMatchObject({
    category: 'truck_stop',
    provider: 'copilot',
  });
  expect(api.request).not.toHaveBeenCalled();
});
test('specialized facilities cannot use generic car categories or unrelated results', async () => {
  mockCatalog.mockResolvedValue([{ id: 1, name: 'Parking', visible: true }]);
  mockHost.searchNativePois.mockResolvedValue([
    poi('City Parking'),
    poi('Truck Parking Center'),
  ]);
  const items = await new CoPilotPoiSearch().nearby('truck_parking', point);
  expect(items.map(item => item.name)).toEqual(['Truck Parking Center']);
  expect(mockHost.searchNativePois).toHaveBeenCalledWith(
    'Truck Parking',
    [],
    40,
    -120,
  );
});
test('aborted native request drains before next search and cannot return stale places', async () => {
  let finish!: (value: unknown) => void;
  mockHost.searchNativePois.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const search = new CoPilotPoiSearch(),
    abort = new AbortController();
  const first = search.nearby('truck_stop', point, abort.signal);
  const rejected = first.catch(error => error);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  abort.abort();
  const second = search.nearby('fuel_stop', point);
  expect(mockHost.searchNativePois).toHaveBeenCalledTimes(1);
  finish([poi('Truck Stop')]);
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  await second;
  expect(mockHost.searchNativePois).toHaveBeenCalledTimes(2);
});
test('along-route filtering excludes behind and distant results', () => {
  const fix = {
    latitude: 40,
    longitude: -120,
    accuracy: 5,
    timestamp: Date.now(),
    speed: 0,
    heading: 0,
  };
  const items = nativePoisAhead(
    [poi('Ahead'), poi('Behind', 39.99), poi('Far away', 40.01, -119)],
    [
      [-120, 39.9],
      [-120, 40.2],
    ],
    fix,
  );
  expect(items.map(item => item.name)).toEqual(['Ahead']);
  expect(items[0]?.routeAccessVerified).toBe(false);
  expect(items[0]?.routeDistanceAheadMeters).toBeGreaterThan(1000);
});
test('native failure never silently changes provider', async () => {
  mockHost.searchNativePois.mockRejectedValue(new Error('not ready'));
  const api = { request: jest.fn() };
  const service = new PoiService(api as never, new CoPilotPoiSearch());
  await expect(service.nearby('truck_stop', point)).rejects.toThrow();
  expect(api.request).not.toHaveBeenCalled();
});
