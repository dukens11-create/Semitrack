import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  UIManager,
} from 'react-native';
import { z } from 'zod';
import { parseCopilotConfiguration, type CopilotConfiguration } from './CopilotConfiguration';
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
  const licensed =
    licensedValue == null
      ? []
      : z.array(z.number().int().nonnegative()).parse(licensedValue);
  const installed =
    installedValue == null
      ? []
      : z.array(mapInfo).parse(installedValue);
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
      // The native boundary must return configuration metadata ONLY, never passwords,
      // product keys, account identifiers, or other secret credential material.
      // Absence of this approved bridge must never initiate CoPilot startup.
      if (Platform.OS !== 'android') return null;
      const bridge = NativeModules.SemiTraxCopilotProvisioning as
        | {
            readConfiguration?: () => Promise<unknown>;
            hasNativeCredential?: (reference: string) => Promise<boolean>;
          }
        | undefined;
      if (
        typeof bridge?.readConfiguration !== 'function' ||
        typeof bridge?.hasNativeCredential !== 'function'
      ) return null;
      try {
        const config = parseCopilotConfiguration(await bridge.readConfiguration());
        if (config.platform !== 'android') return null;
        // A reference alone never proves a valid license or a provisioned secret.
        if ((await bridge.hasNativeCredential(config.credentialRef)) !== true)
          return null;
        return config;
      } catch {
        // Invalid or missing provisioning fails closed without logging credentials.
        return null;
      }
    },
    async startNative(config) {
      // Trimble's React Native CPIK AMS flow configures the license hook
      // BEFORE binding the CoPilot service. This is an AMS identity assignment,
      // not evidence of successful activation or device entitlement.
      if (config.platform !== 'android' || config.licensingMode !== 'ams-company') {
        throw new Error('COPILOT_AMS_COMPANY_CONFIGURATION_REQUIRED');
      }
      const nativeProvisioning = NativeModules.SemiTraxCopilotProvisioning as
        | { configureAMSLogin?: () => Promise<boolean> }
        | undefined;
      // Never send AMS identity through JS or attempt startup unless a trusted
      // native boundary has provisioned it and confirmed hook configuration.
      if (typeof nativeProvisioning?.configureAMSLogin !== 'function' ||
          (await nativeProvisioning.configureAMSLogin()) !== true) {
        throw new Error('COPILOT_AMS_NATIVE_HOOK_REQUIRED');
      }
      const startupModule = NativeModules.CopilotStartupMgr as
        | { bindCoPilotService?: () => Promise<void> | void }
        | undefined;
      if (!startupModule || typeof startupModule.bindCoPilotService !== 'function') {
        throw new Error('COPILOT_NATIVE_STARTUP_VALIDATION_REQUIRED');
      }
      await startupModule.bindCoPilotService();
    },
    async licenseState() {
      const licensingReady =
        (await call('LicenseMgr', 'isLicensingReady')) === true;
      if (!licensingReady)
        return {
          licensingReady,
          fullNavigationLicensed: false,
          heavyTruckLicensed: false,
        };
      const licensed = constant('FeatureStatus', 'LICENSED');
      const unlimited = constant('FeatureStatus', 'UNLIMITED');
      const full = await call(
        'LicenseMgr',
        'getFeatureStatus',
        constant('LicenseFeature', 'FULL_NAVIGATION'),
      );
      const truck = await call(
        'LicenseMgr',
        'getFeatureStatus',
        constant('LicenseFeature', 'TRUCK_HEAVY_DUTY'),
      );
      return {
        licensingReady,
        fullNavigationLicensed: full === licensed || full === unlimited,
        heavyTruckLicensed: truck === licensed || truck === unlimited,
      };
    },
    async mapState(config) {
      const region = constant('MapRegion', config.mapRegionConstant);
      const inventory = inspectInstalledMaps(
        await call('MapDataMgr', 'getLicensedMapList'),
        await call('MapDataMgr', 'getInstalledMaps'),
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
