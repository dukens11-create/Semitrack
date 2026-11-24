import { LocationService, type LocationProvider } from '../src/services/location/LocationService';
function fixture() {
  let emit: (raw: unknown) => void = () => {};
  let error: (message: string) => void = () => {};
  const provider: LocationProvider = {
    permissionStatus: jest.fn(async () => 'granted'),
    permission: jest.fn(async () => 'granted'),
    start: jest.fn(async () => {}), stop: jest.fn(async () => {}),
    subscribe: jest.fn((onFix, onError) => { emit = onFix; error = onError; return jest.fn(); }),
  };
  return { provider, service: new LocationService(provider), emit: (raw: unknown) => emit(raw), error: () => error('paused') };
}
const fix = (overrides = {}) => ({ latitude: 40, longitude: -100, accuracy: 4, timestamp: Date.now(), heading: null, speed: 0, ...overrides });
let cases: ReturnType<typeof fixture>[] = [];
const setup = () => { const f = fixture(); cases.push(f); return f; };
beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => { for (const f of cases) await f.service.stop(); cases = []; jest.useRealTimers(); });
const flush = () => jest.advanceTimersByTimeAsync(0);
test('route request obtains missing permission and waits for an actual precise fix', async () => {
  const f = setup(); jest.mocked(f.provider.permissionStatus).mockResolvedValue('denied');
  const request = f.service.requestFreshFix(); let resolved = false; void request.then(() => { resolved = true; });
  await flush(); expect(f.provider.permission).toHaveBeenCalledWith(false); expect(f.provider.start).toHaveBeenCalledWith(false); expect(resolved).toBe(false);
  f.emit(fix()); expect(await request).toMatchObject({ accuracy: 4, latitude: 40 });
});
test('denial never starts GPS or returns an old retained fix', async () => {
  const f = setup(); await f.service.start(); f.emit(fix());
  jest.mocked(f.provider.permissionStatus).mockResolvedValue('denied'); jest.mocked(f.provider.permission).mockResolvedValue('denied'); jest.mocked(f.provider.start).mockClear();
  await expect(f.service.requestFreshFix()).rejects.toMatchObject({ code: 'GPS_PERMISSION_REQUIRED' });
  expect(f.provider.start).not.toHaveBeenCalled(); expect(f.service.getFreshFix()).toBeNull();
});
test('fresh permission-verified fix is reused without restarting the provider', async () => {
  const f = setup(); await f.service.start(); f.emit(fix());
  expect(await f.service.requestFreshFix()).toMatchObject({ accuracy: 4 }); expect(f.provider.start).toHaveBeenCalledTimes(1);
});
test.each([{ timestamp: () => Date.now() - 15001 }, { timestamp: () => Date.now() + 5001 }, { accuracy: 100.01 }])('rejects invalid fix and waits for a real replacement: %p', async bad => {
  const f = setup(); const request = f.service.requestFreshFix(); let resolved = false; void request.then(() => { resolved = true; }); await flush();
  f.emit(fix('timestamp' in bad ? { timestamp: bad.timestamp!() } : bad)); await flush(); expect(resolved).toBe(false);
  f.emit(fix()); expect(await request).toMatchObject({ accuracy: 4 });
});
test('stale cached fix restarts native acquisition and never becomes a routing origin', async () => {
  const f = setup(); await f.service.start(); f.emit(fix()); await jest.advanceTimersByTimeAsync(15001);
  const request = f.service.requestFreshFix(); await flush(); expect(f.provider.start).toHaveBeenCalledTimes(2);
  f.emit(fix({ accuracy: 3 })); expect(await request).toMatchObject({ accuracy: 3 });
});
test('unchanged thresholds accept 15 seconds age, 100 metres accuracy and 5 seconds future skew only at their boundaries', async () => {
  const f = setup(); await f.service.start(); f.emit(fix({ timestamp: Date.now() - 15000, accuracy: 100 })); expect(f.service.getFreshFix()).not.toBeNull();
  await jest.advanceTimersByTimeAsync(1); expect(f.service.getFreshFix()).toBeNull();
  f.emit(fix({ timestamp: Date.now() + 5000 })); expect(f.service.getFreshFix()).not.toBeNull();
});
test('no sample fails closed after bounded acquisition timeout', async () => {
  const f = setup(); const request = f.service.requestFreshFix(); const rejection = request.catch(error => error);
  await jest.advanceTimersByTimeAsync(30000); expect(await rejection).toMatchObject({ code: 'GPS_ACQUISITION_TIMEOUT' }); expect(f.service.getFreshFix()).toBeNull();
});
test('cancelling acquisition rejects and cannot resolve from a later GPS event', async () => {
  const f = setup(); const controller = new AbortController(); const request = f.service.requestFreshFix(controller.signal); const rejection = request.catch(error => error);
  await flush(); controller.abort(); expect(await rejection).toMatchObject({ code: 'REQUEST_CANCELLED' }); f.emit(fix());
});
test('native pause clears the fix; a subsequent request restarts updates', async () => {
  const f = setup(); await f.service.start(); f.emit(fix()); f.error(); expect(f.service.getFreshFix()).toBeNull();
  const request = f.service.requestFreshFix(); await flush(); f.emit(fix()); await request; expect(f.provider.start).toHaveBeenCalledTimes(2);
});
test('resume while the permission request is pending does not cancel its startup generation', async () => {
  const f = setup(); let grant!: (value: string) => void; jest.mocked(f.provider.permission).mockReturnValue(new Promise(resolve => { grant = resolve; }));
  const start = f.service.start(); await flush(); const resume = f.service.startIfPermitted(); grant('granted'); await Promise.all([start, resume]);
  f.emit(fix()); expect(f.service.getFreshFix()).not.toBeNull(); expect(f.provider.start).toHaveBeenCalledTimes(1);
});
