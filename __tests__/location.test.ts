import {
  LocationService,
  type LocationProvider,
} from '../src/services/location/LocationService';
function provider() {
  let emit: (fix: unknown) => void = () => {};
  const mock: LocationProvider = {
    permissionStatus: jest.fn(async () => 'granted'),
    permission: jest.fn(async () => 'granted'),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    subscribe: jest.fn(callback => {
      emit = callback;
      return jest.fn();
    }),
  };
  return { mock, emit: (fix: unknown) => emit(fix) };
}
const fix = () => ({
  latitude: 40,
  longitude: -100,
  accuracy: 5,
  timestamp: Date.now(),
  heading: 90,
  speed: 10,
});
afterEach(() => jest.useRealTimers());
test('fresh precise GPS accepted; stale inaccurate and out-of-order updates rejected', async () => {
  jest.useFakeTimers();
  const p = provider();
  const service = new LocationService(p.mock);
  await service.start();
  p.emit({ ...fix(), accuracy: 500 });
  expect(service.getSnapshot().fix).toBeNull();
  p.emit(fix());
  const accepted = service.getSnapshot().fix;
  p.emit({ ...fix(), timestamp: Date.now() - 1000 });
  expect(service.getSnapshot().fix).toBe(accepted);
  jest.advanceTimersByTime(20000);
  expect(service.getSnapshot().fix).toBeNull();
  await service.stop();
  expect(service.getSnapshot().tracking).toBe(false);
});
test('permission denial never starts provider', async () => {
  const p = provider();
  p.mock.permission = jest.fn(async () => 'denied');
  const service = new LocationService(p.mock);
  await expect(service.start()).rejects.toThrow(/permission/);
  expect(p.mock.start).not.toHaveBeenCalled();
  await service.stop();
});

test('map opening reuses granted permission without prompting', async () => {
  const p = provider();
  const service = new LocationService(p.mock);
  await service.startIfPermitted();
  expect(p.mock.permissionStatus).toHaveBeenCalledTimes(1);
  expect(p.mock.permission).not.toHaveBeenCalled();
  expect(p.mock.start).toHaveBeenCalledWith(false);
  await service.startIfPermitted();
  expect(p.mock.start).toHaveBeenCalledTimes(1);
  await service.stop();
});
test('map opening without permission does not prompt or start GPS', async () => {
  const p = provider();
  p.mock.permissionStatus = jest.fn(async () => 'denied');
  const service = new LocationService(p.mock);
  await service.startIfPermitted();
  expect(p.mock.permission).not.toHaveBeenCalled();
  expect(p.mock.start).not.toHaveBeenCalled();
  expect(service.getSnapshot().tracking).toBe(false);
  await service.stop();
});
