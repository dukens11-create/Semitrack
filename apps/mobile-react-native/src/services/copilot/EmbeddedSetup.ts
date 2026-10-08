import { PermissionsAndroid, Platform } from 'react-native';
import { z } from 'zod';
import { nativeCopilotModule } from './NativeModuleLookup';
import {
  deviceLicenseSchema,
  saveDeviceLicense,
  type DeviceLicense,
} from './DeviceActivation';

const connectionSchema = z.object({
  started: z.boolean(),
  connected: z.boolean(),
});
const mapSchema = z.array(
  z.object({
    set: z.number().int().nonnegative(),
    year: z.number().int(),
    quarter: z.number().int(),
    versionString: z.string(),
  }),
);
export type EmbeddedSetupReport = {
  started: boolean;
  licensingReady: boolean;
  fullNavigationLicensed: boolean;
  heavyTruckLicensed: boolean;
  licensedRegions: string[];
  installedMapCount: number;
};
export class EmbeddedSetupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EmbeddedSetupError';
  }
}
function module(name: string): Record<string, unknown> {
  const value = nativeCopilotModule(name);
  if (!value)
    throw new EmbeddedSetupError(
      name === 'SemiTraxCoPilotSetup'
        ? 'COPILOT_SETUP_HOST_UNAVAILABLE'
        : 'COPILOT_MODULE_UNAVAILABLE',
    );
  return value;
}
async function call(
  name: string,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const object = module(name);
  const fn = object[method];
  if (typeof fn !== 'function')
    throw new EmbeddedSetupError('COPILOT_MODULE_UNAVAILABLE');
  return fn.apply(object, args);
}
function constant(name: string, key: string): number {
  return z.number().int().nonnegative().parse(module(name)[key]);
}
const nativeErrors = new Set([
  'COPILOT_FOREGROUND_REQUIRED',
  'COPILOT_LOCATION_REQUIRED',
  'COPILOT_RESTART_REQUIRED',
  'COPILOT_SETUP_BUSY',
  'COPILOT_MODULE_UNAVAILABLE',
  'COPILOT_SETUP_HOST_UNAVAILABLE',
  'COPILOT_LICENSE_BRIDGE_UNAVAILABLE',
  'COPILOT_BIND_TIMEOUT',
  'COPILOT_BIND_FAILED',
  'COPILOT_SERVICE_FAILED',
  'COPILOT_SERVICE_DISCONNECTED',
  'DEVICE_SETTINGS_SAVE_FAILED',
]);

/** Setup evidence only. No route, profile, download, or guidance mutation. */
export async function checkEmbeddedSetup(
  value: DeviceLicense,
  signal: AbortSignal,
): Promise<EmbeddedSetupReport> {
  if (Platform.OS !== 'android')
    throw new EmbeddedSetupError('COPILOT_ANDROID_REQUIRED');
  const license = deviceLicenseSchema.parse(value);
  const alive = () => {
    if (signal.aborted) throw new EmbeddedSetupError('COPILOT_CHECK_CANCELLED');
  };
  try {
    alive();
    // Fail early on old APKs before prompting for permissions or writing IDs.
    if (typeof module('SemiTraxCoPilotSetup').startSetup !== 'function')
      throw new EmbeddedSetupError('COPILOT_SETUP_HOST_UNAVAILABLE');
    let precise = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (!precise) {
      const permissions = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      precise =
        permissions[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;
    }
    alive();
    if (!precise) throw new EmbeddedSetupError('COPILOT_LOCATION_REQUIRED');
    await saveDeviceLicense(license);
    alive();
    await call(
      'SemiTraxCoPilotSetup',
      'startSetup',
      license.companyId,
      license.assetId,
    );
    const deadline = Date.now() + 30000;
    let latest: EmbeddedSetupReport | undefined;
    do {
      alive();
      const connection = connectionSchema.parse(
        await call('SemiTraxCoPilotSetup', 'readSetupState'),
      );
      if (!connection.connected)
        throw new EmbeddedSetupError('COPILOT_SERVICE_DISCONNECTED');
      if (connection.started) {
        const licensingReady = z
          .boolean()
          .parse(await call('LicenseMgr', 'isLicensingReady'));
        latest = {
          started: true,
          licensingReady,
          fullNavigationLicensed: false,
          heavyTruckLicensed: false,
          licensedRegions: [],
          installedMapCount: 0,
        };
        if (licensingReady) {
          const statuses = [
            constant('FeatureStatus', 'LICENSED'),
            constant('FeatureStatus', 'UNLIMITED'),
          ];
          const full = z
            .number()
            .int()
            .parse(
              await call(
                'LicenseMgr',
                'getFeatureStatus',
                constant('LicenseFeature', 'FULL_NAVIGATION'),
              ),
            );
          const truck = z
            .number()
            .int()
            .parse(
              await call(
                'LicenseMgr',
                'getFeatureStatus',
                constant('LicenseFeature', 'TRUCK_HEAVY_DUTY'),
              ),
            );
          latest.fullNavigationLicensed = statuses.includes(full);
          latest.heavyTruckLicensed = statuses.includes(truck);
          const regions = z
            .array(z.number().int().nonnegative())
            .parse(await call('MapDataMgr', 'getLicensedMapList'));
          const constants = module('MapRegion');
          latest.licensedRegions = regions.map(
            id =>
              Object.keys(constants).find(
                key => /^[A-Za-z0-9_]+$/.test(key) && constants[key] === id,
              ) ?? `Region ${id}`,
          );
          latest.installedMapCount = mapSchema.parse(
            await call('MapDataMgr', 'getInstalledMaps'),
          ).length;
          if (latest.fullNavigationLicensed && latest.heavyTruckLicensed)
            return latest;
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    alive();
    if (latest) return latest;
    throw new EmbeddedSetupError('COPILOT_STARTUP_TIMEOUT');
  } catch (error) {
    if (error instanceof EmbeddedSetupError) throw error;
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    throw new EmbeddedSetupError(
      typeof code === 'string' && nativeErrors.has(code)
        ? code
        : 'COPILOT_CHECK_FAILED',
    );
  }
}

export function embeddedSetupMessage(report: EmbeddedSetupReport): string {
  const licensing = !report.licensingReady
    ? 'License check has not completed. Verify the device assignment in Trimble Account Manager.'
    : !report.fullNavigationLicensed || !report.heavyTruckLicensed
    ? 'Full navigation and truck licenses were not both confirmed. Check this device’s assigned license with Trimble.'
    : 'Full navigation and truck licenses confirmed.';
  return `Embedded CoPilot started. ${licensing} Licensed regions: ${report.licensedRegions.length}. Installed map packages: ${report.installedMapCount}. Map coverage and compatibility still need verification. Turn-by-turn guidance is not enabled.`;
}
