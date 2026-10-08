import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  checkEmbeddedSetup,
  embeddedSetupMessage,
} from '../src/services/copilot/EmbeddedSetup';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(),
}));
const ids = { companyId: 'assigned-company', assetId: 'Assigned-Device' };
let start: jest.Mock;
let state: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest
    .spyOn(PermissionsAndroid, 'requestMultiple')
    .mockResolvedValue(
      Object.fromEntries(
        Object.values(PermissionsAndroid.PERMISSIONS).map(permission => [
          permission,
          PermissionsAndroid.RESULTS.DENIED,
        ]),
      ) as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>,
    );
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue({});
  start = jest.fn().mockResolvedValue(null);
  state = jest.fn().mockResolvedValue({ connected: true, started: true });
  Object.assign(NativeModules, {
    SemiTraxCoPilotSetup: { startSetup: start, readSetupState: state },
    LicenseMgr: {
      isLicensingReady: jest.fn().mockResolvedValue(true),
      getFeatureStatus: jest.fn().mockResolvedValue(4),
    },
    FeatureStatus: { LICENSED: 4, UNLIMITED: 7 },
    LicenseFeature: { FULL_NAVIGATION: 9, TRUCK_HEAVY_DUTY: 13 },
    MapRegion: { NORTH_AMERICA: 3 },
    MapDataMgr: {
      getLicensedMapList: jest.fn().mockResolvedValue([3]),
      getInstalledMaps: jest.fn().mockResolvedValue([]),
    },
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('uses secure device settings and reports real queried entitlements without claiming guidance', async () => {
  const report = await checkEmbeddedSetup(ids, new AbortController().signal);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'device-license',
    JSON.stringify(ids),
    expect.objectContaining({ service: 'com.semitrax.copilot.device' }),
  );
  expect(start).toHaveBeenCalledWith(ids.companyId, ids.assetId);
  expect(report).toMatchObject({
    fullNavigationLicensed: true,
    heavyTruckLicensed: true,
    installedMapCount: 0,
    licensedRegions: ['NORTH_AMERICA'],
  });
  expect(embeddedSetupMessage(report)).toContain(
    'Turn-by-turn guidance is not enabled',
  );
  expect(embeddedSetupMessage(report)).toContain('Installed map packages: 0');
});
test('never starts native setup when precise location is denied', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  await expect(
    checkEmbeddedSetup(ids, new AbortController().signal),
  ).rejects.toThrow('COPILOT_LOCATION_REQUIRED');
  expect(start).not.toHaveBeenCalled();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});
test('never starts native setup after a secure-storage failure', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(
    new Error('private storage detail'),
  );
  await expect(
    checkEmbeddedSetup(ids, new AbortController().signal),
  ).rejects.toThrow('DEVICE_SETTINGS_SAVE_FAILED');
  expect(start).not.toHaveBeenCalled();
});
test('binding alone cannot be reported as engine startup', async () => {
  state.mockResolvedValue({ connected: true, started: false });
  const promise = checkEmbeddedSetup(ids, new AbortController().signal);
  const failure = promise.then(() => null, error => error as Error);
  await jest.advanceTimersByTimeAsync(31000);
  expect((await failure)?.message).toBe('COPILOT_STARTUP_TIMEOUT');
  expect(NativeModules.LicenseMgr.isLicensingReady).not.toHaveBeenCalled();
});
test('does not infer truck entitlement from successful licensing readiness', async () => {
  NativeModules.LicenseMgr.getFeatureStatus.mockResolvedValue(0);
  const promise = checkEmbeddedSetup(ids, new AbortController().signal);
  await jest.advanceTimersByTimeAsync(31000);
  const report = await promise;
  expect(report).toMatchObject({
    licensingReady: true,
    fullNavigationLicensed: false,
    heavyTruckLicensed: false,
  });
  expect(embeddedSetupMessage(report)).toContain('not both confirmed');
});
test('cancellation stops further native status reads', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(checkEmbeddedSetup(ids, controller.signal)).rejects.toThrow(
    'COPILOT_CHECK_CANCELLED',
  );
  expect(start).not.toHaveBeenCalled();
});
test('disconnected service cannot supply stale startup evidence', async () => {
  state.mockResolvedValue({ connected: false, started: true });
  await expect(
    checkEmbeddedSetup(ids, new AbortController().signal),
  ).rejects.toThrow('COPILOT_SERVICE_DISCONNECTED');
  expect(NativeModules.LicenseMgr.isLicensingReady).not.toHaveBeenCalled();
});
test('vendor errors cannot leak identifiers into setup messages', async () => {
  start.mockRejectedValue({
    code: 'private-code',
    message: 'secret account payload',
  });
  await expect(
    checkEmbeddedSetup(ids, new AbortController().signal),
  ).rejects.toThrow('COPILOT_CHECK_FAILED');
});
