import {
  CopilotLifecycle,
  type CopilotLifecyclePort,
} from '../src/services/copilot/CopilotLifecycle';
import { inspectInstalledMaps } from '../src/services/copilot/CopilotRuntime';
import { parseCopilotConfiguration } from '../src/services/copilot/CopilotConfiguration';
import { truck } from './fixtures';

// Unit fixtures only. These never represent real SDK callbacks or license grants.
const config = parseCopilotConfiguration({
  sdkVersion: '10.28.2.497',
  platform: 'android',
  environment: 'development',
  licensingMode: 'ams-company',
  credentialRef: 'unit-reference',
  mapRegionConstant: 'TEST_REGION',
  mapVersion: { year: 2026, quarter: 1, version: 'unit-map' },
});
function harness() {
  const callbacks = new Map<string, () => void>();
  const sequence: string[] = [];
  const port: CopilotLifecyclePort = {
    modules: () => ({ CopilotMgr: true, LicenseMgr: true }),
    listen: (event, cb) => {
      sequence.push(event);
      callbacks.set(event, cb);
      return () => {
        callbacks.delete(event);
      };
    },
    prepareProvisioning: jest.fn(async () => config),
    startNative: jest.fn(async () => {
      sequence.push('bind');
    }),
    licenseState: jest.fn(async () => ({
      licensingReady: true,
      fullNavigationLicensed: true,
      heavyTruckLicensed: true,
    })),
    mapState: jest.fn(async () => ({
      licensed: [1],
      installed: [
        { set: 1, year: 2026, quarter: 1, versionString: 'unit-map' },
      ],
      mapsReady: true,
      updateStatus: 'CURRENT' as const,
    })),
    readyToAddStops: jest.fn(async () => true),
  };
  const changed = jest.fn();
  const lifecycle = new CopilotLifecycle(port, changed);
  const event = async (name: string) => {
    callbacks.get(name)?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { port, lifecycle, event, sequence, callbacks, changed };
}
afterEach(() => jest.useRealTimers());
test('callbacks precede bind; bind completion cannot fabricate initialization', async () => {
  jest.useFakeTimers();
  const h = harness();
  await h.lifecycle.start();
  expect(h.sequence.indexOf('onLicensingReady')).toBeLessThan(
    h.sequence.indexOf('bind'),
  );
  expect(h.sequence.indexOf('onReadyToAddStops')).toBeLessThan(
    h.sequence.indexOf('bind'),
  );
  expect(h.lifecycle.snapshot().initialized).toBe(false);
  expect(h.lifecycle.snapshot().copilotReady).toBe(false);
  await h.event('onCPStartup');
  expect(h.lifecycle.snapshot()).toMatchObject({
    phase: 'READY',
    initialized: true,
    licensingReady: true,
    mapsReady: true,
    readyToAddStops: true,
    copilotReady: true,
  });
  h.lifecycle.dispose();
});
test('missing module stops before provisioning/binding', async () => {
  const h = harness();
  h.port.modules = () => ({ LicenseMgr: false });
  await h.lifecycle.start();
  expect(h.lifecycle.snapshot().error).toBe('COPILOT_NOT_INITIALIZED');
  expect(h.port.startNative).not.toHaveBeenCalled();
  h.lifecycle.dispose();
});
test('missing provisioning reports an actionable state without binding', async () => {
  const h = harness();
  h.port.prepareProvisioning = async () => null;
  await h.lifecycle.start();
  expect(h.lifecycle.snapshot().error).toBe(
    'COPILOT_LICENSE_PROVISIONING_REQUIRED',
  );
  expect(h.port.startNative).not.toHaveBeenCalled();
  h.lifecycle.dispose();
});
test('startup rejection is contained and does not expose supplied native error text', async () => {
  const h = harness();
  h.port.startNative = async () => {
    throw new Error('unit-secret-canary');
  };
  await expect(h.lifecycle.start()).resolves.toBeUndefined();
  expect(h.lifecycle.snapshot().error).toBe('COPILOT_NOT_INITIALIZED');
  expect(JSON.stringify(h.changed.mock.calls)).not.toContain(
    'unit-secret-canary',
  );
  h.lifecycle.dispose();
});
test('missing initialization callback times out without inventing ready', async () => {
  jest.useFakeTimers();
  const h = harness();
  await h.lifecycle.start();
  jest.advanceTimersByTime(30000);
  expect(h.lifecycle.snapshot().operation).toBe('startup-timeout');
  h.lifecycle.dispose();
});
test.each([
  'licensingReady',
  'fullNavigationLicensed',
  'heavyTruckLicensed',
] as const)('missing %s blocks maps and routing', async field => {
  const h = harness();
  h.port.licenseState = async () => ({
    licensingReady: true,
    fullNavigationLicensed: true,
    heavyTruckLicensed: true,
    [field]: false,
  });
  await h.lifecycle.start();
  await h.event('onCPStartup');
  expect(h.lifecycle.snapshot().error).toBe(
    'COPILOT_LICENSE_PROVISIONING_REQUIRED',
  );
  expect(h.port.mapState).not.toHaveBeenCalled();
  h.lifecycle.dispose();
});
test('licensing callback rechecks entitlements and maps', async () => {
  const h = harness();
  h.port.licenseState = jest
    .fn()
    .mockResolvedValueOnce({
      licensingReady: false,
      fullNavigationLicensed: false,
      heavyTruckLicensed: false,
    })
    .mockResolvedValue({
      licensingReady: true,
      fullNavigationLicensed: true,
      heavyTruckLicensed: true,
    });
  await h.lifecycle.start();
  await h.event('onCPStartup');
  await h.event('onLicensingReady');
  expect(h.lifecycle.snapshot().copilotReady).toBe(true);
  h.lifecycle.dispose();
});
test('missing maps stay blocked until inventory is rechecked', async () => {
  const h = harness();
  const complete = h.port.mapState;
  h.port.mapState = async () => ({
    licensed: [],
    installed: [],
    mapsReady: false,
    updateStatus: 'NOT_CHECKED',
  });
  await h.lifecycle.start();
  await h.event('onCPStartup');
  expect(h.lifecycle.snapshot()).toMatchObject({
    phase: 'MAPS_REQUIRED',
    error: 'COPILOT_MAP_DATA_REQUIRED',
  });
  h.port.mapState = complete;
  await h.event('onMapdataUpdate');
  expect(h.lifecycle.snapshot().copilotReady).toBe(true);
  h.lifecycle.dispose();
});
test('not-ready-to-add-stops blocks even with license and maps', async () => {
  const h = harness();
  h.port.readyToAddStops = async () => false;
  await h.lifecycle.start();
  await h.event('onCPStartup');
  expect(h.lifecycle.snapshot().error).toBe('COPILOT_NOT_READY');
  h.port.readyToAddStops = async () => true;
  await h.event('onReadyToAddStops');
  expect(h.lifecycle.snapshot().copilotReady).toBe(true);
  h.lifecycle.dispose();
});
test('truck restrictions remain fail-closed despite lifecycle readiness', async () => {
  const h = harness();
  await h.lifecycle.start();
  await h.event('onCPStartup');
  expect(() => h.lifecycle.requireRoutePermission(truck)).toThrow();
  expect(h.lifecycle.snapshot().error).toBe('COPILOT_TRUCK_PROFILE_INVALID');
  h.lifecycle.dispose();
});
test.each(['onFailedRouteCalculation', 'onRouteSyncError'])(
  'route error %s is not converted into success by completion or readiness events',
  async name => {
    const h = harness();
    await h.lifecycle.start();
    await h.event('onCPStartup');
    await h.event(name);
    await h.event('onCompleteRouteCalculation');
    await h.event('onReadyToAddStops');
    expect(h.lifecycle.snapshot().error).toBe('COPILOT_ROUTE_FAILED');
    expect(h.lifecycle.snapshot().copilotReady).toBe(false);
    h.lifecycle.dispose();
  },
);
test('guidance remains unavailable without a verified route', () => {
  const h = harness();
  expect(() => h.lifecycle.requireGuidancePermission()).toThrow();
  expect(h.lifecycle.snapshot().error).toBe('COPILOT_GUIDANCE_UNAVAILABLE');
  h.lifecycle.dispose();
});
test('commercial warning is retained prominently without logging native payload', async () => {
  const h = harness();
  await h.lifecycle.start();
  await h.event('onTruckRestricted');
  expect(h.lifecycle.snapshot().warning).toContain(
    'commercial road restriction',
  );
  h.lifecycle.dispose();
});
test('shutdown invalidates readiness and subscription cleanup prevents later updates', async () => {
  const h = harness();
  await h.lifecycle.start();
  await h.event('onCPStartup');
  await h.event('onCPShutdown');
  expect(h.lifecycle.snapshot()).toMatchObject({
    initialized: false,
    mapsReady: false,
    readyToAddStops: false,
    copilotReady: false,
  });
  h.lifecycle.dispose();
  expect(h.callbacks.size).toBe(0);
});
test('late query results cannot restore readiness after shutdown', async () => {
  const h = harness();
  let resolve!: (value: boolean) => void;
  h.port.readyToAddStops = () =>
    new Promise(done => {
      resolve = done;
    });
  await h.lifecycle.start();
  await h.event('onCPStartup');
  await h.event('onCPShutdown');
  resolve(true);
  await h.event('onStopsAdded');
  expect(h.lifecycle.snapshot().copilotReady).toBe(false);
  h.lifecycle.dispose();
});
test('inventory requires licensed exact region and installed exact version', () => {
  const maps = [{ set: 1, year: 2026, quarter: 1, versionString: 'unit-map' }];
  expect(inspectInstalledMaps([1], maps, 1, config).mapsReady).toBe(true);
  expect(inspectInstalledMaps([], maps, 1, config).mapsReady).toBe(false);
  expect(inspectInstalledMaps([2], maps, 2, config).mapsReady).toBe(false);
  expect(inspectInstalledMaps([1], [], 1, config).mapsReady).toBe(false);
  expect(
    inspectInstalledMaps(
      [1],
      [{ ...maps[0], versionString: 'other' }],
      1,
      config,
    ).mapsReady,
  ).toBe(false);
  expect(() => inspectInstalledMaps([1], [{ set: 1 }], 1, config)).toThrow();
});

test('disposed provisioning cannot replace the next startup configuration', async () => {
  const h = harness();
  let complete!: (value: typeof config | null) => void;
  h.port.prepareProvisioning = () =>
    new Promise(resolve => {
      complete = resolve;
    });
  const first = h.lifecycle.start();
  h.lifecycle.dispose();
  h.port.prepareProvisioning = async () => null;
  await h.lifecycle.start();
  complete(config);
  await first;
  expect(h.lifecycle.snapshot().error).toBe(
    'COPILOT_LICENSE_PROVISIONING_REQUIRED',
  );
  expect(h.port.startNative).not.toHaveBeenCalled();
  h.lifecycle.dispose();
});
test('failure querying maps remains non-ready and does not escape the callback', async () => {
  const h = harness();
  h.port.mapState = async () => {
    throw new Error('unit-map-error');
  };
  await h.lifecycle.start();
  await h.event('onCPStartup');
  expect(h.lifecycle.snapshot()).toMatchObject({
    error: 'COPILOT_NOT_READY',
    copilotReady: false,
  });
  h.lifecycle.dispose();
});
