import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';
export interface CoPilotSetupDiagnostics {
  buildIdentity?: {
    commit: string;
    builtAt: string;
    packageName: string;
    variant: string;
    versionCode: number;
    versionName: string;
  };
  controlTimeline?: { action: string; stage: string; elapsedMs: number }[];
  nativeDisplay?: {
    status: string;
    deviceUtcOffsetMinutes: number;
    headingDisplayEnabled?: boolean;
    speedLimitOnMap?: boolean;
    poiAlertsEnabled?: boolean;
    poiAlertDistance?: string;
    poiAlertCategoryCount?: number;
    poiDisplayedCategoryCount?: number;
    etaMinutesFromNow?: number;
  };
  appStorage?: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    availableBytes?: number;
    totalBytes?: number;
  };
  mapDownload?: {
    response: string;
    callback: string;
    status: string;
    stage: string;
    attempts: number;
    cellularAllowed: boolean;
    initialMapSignalReceived: boolean;
  };
  savedCompanyMatches: boolean;
  savedDeviceMatches: boolean;
  credentialHook: string;
  hookMatchedAssigned: boolean;
  callbackMatchedAssigned: boolean;
  loginResponse: string;
  canRepairTypo: boolean;
  restartRequired: boolean;
  deviceConfigured?: boolean;
  deviceConfigurationStatus?: string;
  deviceReadbackKind?: string;
  reportBuild?: string;
  androidApi?: number;
  engineStarted?: boolean;
  serviceBound?: boolean;
  serviceConnected?: boolean;
  sdkVersion?: string;
  droppedEvents?: number;
  timeline?: {
    sequence: number;
    elapsedMs: number;
    event: string;
    started: boolean;
    deviceVerified: boolean;
    response: string;
  }[];
}
export interface CoPilotHost {
  recordHybridControl?(action: string, stage: string): Promise<void>;
  applyTruckProfile?(profile: unknown): Promise<void>;
  endEngineTrip?(): Promise<void>;
  hasEngineTrip?(): Promise<boolean>;
  resumeEngineTrip?(): Promise<void>;
  reviewEngineTripProfile?(): Promise<unknown>;
  openEngineTrip?(
    ticket: string,
    locations: { lat: number; lng: number; name: string }[],
  ): Promise<void>;
  returnFromEngineTrip?(): Promise<void>;
  searchNativePois?(
    name: string,
    ids: number[],
    lat: number,
    lng: number,
  ): Promise<unknown>;
  poiCatalog?(): Promise<unknown>;
  setPoiCategoryVisible?(id: number, visible: boolean): Promise<unknown>;
  guidanceSnapshot?(): Promise<unknown>;
  guidanceMapSnapshot?(): Promise<unknown>;
  setupDiagnostics?(): Promise<CoPilotSetupDiagnostics>;
  repairAssignedSetup?(): Promise<void>;
  readonly automaticAssignedSetup?: boolean;
  configureDevice(
    company: string,
    device: string,
    region: string,
  ): Promise<void>;
  prepareDevice(): Promise<unknown>;
  mapInventory(): Promise<unknown>;
  licensedMapCatalog?(): Promise<
    { name: string; installed: boolean; downloadStatus?: string }[]
  >;
  downloadLicensedRegions?(names: string[], cellular: boolean): Promise<string>;
  downloadSelectedMap(): Promise<string>;
  downloadSelectedMapUsingCellular?(): Promise<string>;
  setMapAppearance(night: boolean): Promise<void>;
  mapCommand(command: string): Promise<void>;
  drawRoutePreview(
    points: readonly (readonly [number, number])[],
  ): Promise<void>;
  mapFrame(
    west: number,
    south: number,
    east: number,
    north: number,
  ): Promise<void>;
  drawMarkers(
    markers: { id: number; lat: number; lng: number }[],
  ): Promise<void>;
}
export function coPilotHost(): CoPilotHost {
  const host = NativeModules.SemiTraxCoPilotHost as CoPilotHost | undefined;
  if (Platform.OS !== 'android' || !host)
    throw new Error('SemiTraX native host unavailable');
  return host;
}
const inventory = z.object({
  licensed: z.array(z.number().int().nonnegative()),
  selectedRegion: z.number().int().nonnegative(),
  installed: z.array(
    z.object({
      set: z.number().int(),
      year: z.number().int().min(2000),
      quarter: z.number().int().min(1).max(4),
      versionString: z.string().min(1),
    }),
  ),
});
export async function selectedMapInstalled(): Promise<boolean> {
  const value = inventory.parse(await coPilotHost().mapInventory());
  return (
    value.licensed.includes(value.selectedRegion) &&
    value.installed.some(map => map.set === value.selectedRegion)
  );
}
