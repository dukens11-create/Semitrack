import { CoPilotPoiSearch } from '../src/services/copilot/CoPilotPoiSearch';
import { coPilotHost } from '../src/services/copilot/CoPilotHost';
import { readCoPilotPlaces } from '../src/services/copilot/CoPilotPlaces';
jest.mock('../src/services/copilot/CoPilotHost', () => ({ coPilotHost: jest.fn() }));
jest.mock('../src/services/copilot/CoPilotPlaces', () => ({ readCoPilotPlaces: jest.fn() }));
const center = { lat: 40, lng: -100 };
let native: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  native = jest.fn().mockResolvedValue([{ id: 'one', name: 'Truck Stop', provider: 'copilot', latitude: 40, longitude: -100 }]);
  jest.mocked(coPilotHost).mockReturnValue({ searchNativePois: native } as never);
  jest.mocked(readCoPilotPlaces).mockResolvedValue([{ id: 1, name: 'Truck Stops', visible: true }]);
});
afterEach(() => jest.useRealTimers());
test('identical concurrent searches share native work and returned rows are isolated', async () => {
  const search = new CoPilotPoiSearch();
  const [a, b] = await Promise.all([search.nearby('truck_stop', center), search.nearby('truck_stop', center)]);
  expect(native).toHaveBeenCalledTimes(1);
  a[0]!.name = 'changed';
  expect(b[0]!.name).toBe('Truck Stop');
});
test('results expire and moved centers require a new native query', async () => {
  const search = new CoPilotPoiSearch();
  await search.nearby('truck_stop', center);
  jest.advanceTimersByTime(60000);
  await search.nearby('truck_stop', center);
  await search.nearby('truck_stop', { ...center, lat: 40.01 });
  expect(native).toHaveBeenCalledTimes(3);
});
test('aborted requests cannot return cached results', async () => {
  const search = new CoPilotPoiSearch(); await search.nearby('truck_stop', center);
  const controller = new AbortController(); controller.abort();
  await expect(search.nearby('truck_stop', center, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(native).toHaveBeenCalledTimes(1);
});
test('provider failures are not cached and a later attempt can recover', async () => {
  const search = new CoPilotPoiSearch(); native.mockRejectedValueOnce(new Error('offline'));
  await expect(search.nearby('truck_stop', center)).rejects.toThrow();
  expect(await search.nearby('truck_stop', center)).toHaveLength(1);
  expect(native).toHaveBeenCalledTimes(2);
});
test('cache is bounded to 24 queries', async () => {
  const search = new CoPilotPoiSearch();
  for (let i = 0; i < 25; i++) await search.nearby('truck_stop', { lat: 40 + i / 100, lng: -100 });
  await search.nearby('truck_stop', center);
  expect(native).toHaveBeenCalledTimes(26);
});
