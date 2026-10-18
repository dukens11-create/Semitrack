import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  UIManager,
} from 'react-native';
import { z } from 'zod';
import {
  parseCopilotConfiguration,
  type CopilotConfiguration,
} from './CopilotConfiguration';
import type {
  CopilotLifecyclePort,
  CopilotMapInventory,
} from './CopilotLifecycle';

const mapInfo = z.object({
  set: z.number().int().nonnegative(),
  year: z.number().int().min(2000),
  quarter: z.number().int().min(1).max(4),
  versionString: z.string().min(1),
});
/** Parse only documented inventory fields; never mistake a download callback for installation. */
export function inspectInstalledMaps(
  licensedValue: unknown,
  installedValue: unknown,
  region: number,
  config: CopilotConfiguration,
): CopilotMapInventory {
  const licensed = z.array(z.number().int().nonnegative()).parse(licensedValue);
  const installed = z.array(mapInfo).parse(installedValue);
  const mapsReady =
    licensed.includes(region) &&
    installed.some(
      map =>
        map.set === region &&
        map.year === config.mapVersion.year &&
        map.quarter === config.mapVersion.quarter &&
        map.versionString === config.mapVersion.version,
    );
  return { licensed, installed, mapsReady, updateStatus: 'NOT_CHECKED' };
}
const moduleMethods: Record<string, readonly string[]> = {
  SemiTraxCoPilotHost: [
    'prepareDevice',
    'startEngine',
    'licenseState',
    'mapInventory',
  ],
  CopilotMgr: ['getVersionInfo'],
  CopilotStartupMgr: ['bindCoPilotService'],
  LicenseMgr: ['isLicensingReady', 'getFeatureStatus'],
  MapDataMgr: ['getLicensedMapList', 'getInstalledMaps', 'checkMapUpdate'],
  RouteMgr: ['isCopilotReadyToAddStops', 'calculateRoute'],
  GuidanceMgr: ['getTurnInstruction', 'getETA', 'getDistanceToDestination'],
  SpeechMgr: ['getCurrentVoice', 'getCurrentLanguage', 'playSpeechSample'],
  CopilotListener: ['registerListener'],
  LicenseListener: ['registerListener'],
  MapDataListener: ['registerListener'],
  RouteListener: ['registerListener'],
  GuidanceListener: ['registerListener'],
  SpeechListener: ['registerListener'],
};
function moduleObject(name: string): Record<string, unknown> {
  const value: unknown = NativeModules[name];
  if (!value || typeof value !== 'object')
    throw new Error('Native module unavailable');
  return value as Record<string, unknown>;
}
function constant(module: string, key: string): number {
  const value = moduleObject(module)[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error('Native constant unavailable');
  return value;
}
async function call(
  module: string,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const object = moduleObject(module);
  const fn = object[method];
  if (typeof fn !== 'function') throw new Error('Native method unavailable');
  return fn.apply(object, args);
}
export function createCopilotRuntime(): CopilotLifecyclePort {
  return {
    modules() {
      const result: Record<string, boolean> = {
        Android: Platform.OS === 'android',
      };
      for (const [name, methods] of Object.entries(moduleMethods)) {
        try {
          const module = moduleObject(name);
          result[name] = methods.every(
            method => typeof module[method] === 'function',
          );
        } catch {
          result[name] = false;
        }
      }
      // Access instantiates the shipped listener modules, whose constructors register native hooks.
      // Do not duplicate their native registerListener calls on each React render.
      try {
        result.CopilotView = !!UIManager.getViewManagerConfig('CopilotView');
      } catch {
        result.CopilotView = false;
      }
      return result;
    },
    listen(event, callback) {
      // Never retain or log callback payloads (AMS callbacks can include account identifiers).
      const subscription = DeviceEventEmitter.addListener(event, callback);
      return () => subscription.remove();
    },
    async prepareProvisioning() {
      const config = await call('SemiTraxCoPilotHost', 'prepareDevice');
      return config === null ? null : parseCopilotConfiguration(config);
    },
    async configuration() {
      const config = await call('SemiTraxCoPilotHost', 'prepareDevice');
      return config === null ? null : parseCopilotConfiguration(config);
    },
    async startNative() {
      await call('SemiTraxCoPilotHost', 'startEngine');
    },
    async licenseState() {
      return z
        .object({
          licensingReady: z.boolean(),
          fullNavigationLicensed: z.boolean(),
          heavyTruckLicensed: z.boolean(),
        })
        .parse(await call('SemiTraxCoPilotHost', 'licenseState'));
    },
    async mapState(config) {
      const region = constant('MapRegion', config.mapRegionConstant);
      const native = z
        .object({
          licensed: z.array(z.number().int()),
          installed: z.array(mapInfo),
          selectedRegion: z.number().int(),
        })
        .parse(await call('SemiTraxCoPilotHost', 'mapInventory'));
      if (native.selectedRegion !== region)
        throw new Error('Selected region mismatch');
      const inventory = inspectInstalledMaps(
        native.licensed,
        native.installed,
        region,
        config,
      );
      if (!inventory.mapsReady) return inventory;
      try {
        const update = await call(
          'MapDataMgr',
          'checkMapUpdate',
          region,
          config.mapVersion.year,
          config.mapVersion.quarter,
        );
        const parsed = mapInfo.safeParse(update);
        inventory.updateStatus = parsed.success
          ? parsed.data.year === config.mapVersion.year &&
            parsed.data.quarter === config.mapVersion.quarter &&
            parsed.data.versionString === config.mapVersion.version
            ? 'CURRENT'
            : 'AVAILABLE'
          : 'UNKNOWN';
      } catch {
        inventory.updateStatus = 'UNKNOWN';
      }
      return inventory;
    },
    async readyToAddStops() {
      return (await call('RouteMgr', 'isCopilotReadyToAddStops')) === true;
    },
  };
}
