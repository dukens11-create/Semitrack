import type { CopilotConfiguration } from './CopilotConfiguration';
import { CopilotP0Error } from './CopilotConfiguration';
import { assessCopilotTruckProfile } from './CopilotTruckProfile';

export type CopilotErrorCode =
  | 'COPILOT_NOT_INITIALIZED'
  | 'COPILOT_LICENSE_PROVISIONING_REQUIRED'
  | 'COPILOT_MAP_DATA_REQUIRED'
  | 'COPILOT_NOT_READY'
  | 'COPILOT_TRUCK_PROFILE_INVALID'
  | 'COPILOT_ROUTE_FAILED'
  | 'COPILOT_GUIDANCE_UNAVAILABLE';
export type CopilotPhase =
  | 'NOT_STARTED'
  | 'STARTING'
  | 'LICENSING'
  | 'MAPS_REQUIRED'
  | 'READY'
  | 'ERROR';
export interface CopilotMapInventory {
  licensed: number[];
  installed: {
    set: number;
    year: number;
    quarter: number;
    versionString: string;
  }[];
  mapsReady: boolean;
  updateStatus: 'NOT_CHECKED' | 'CURRENT' | 'AVAILABLE' | 'UNKNOWN';
}
export interface CopilotState {
  phase: CopilotPhase;
  error: CopilotErrorCode | null;
  operation: string | null;
  modules: Record<string, boolean>;
  initialized: boolean;
  licensingReady: boolean;
  fullNavigationLicensed: boolean;
  heavyTruckLicensed: boolean;
  mapsReady: boolean;
  readyToAddStops: boolean;
  copilotReady: boolean;
  maps: CopilotMapInventory | null;
  warning: string | null;
  lastEvent: string | null;
}
/** Secrets stay inside the provisioning implementation, never in snapshots. */
export interface CopilotLifecyclePort {
  modules(): Record<string, boolean>;
  listen(event: string, callback: () => void): () => void;
  prepareProvisioning(): Promise<CopilotConfiguration | null>;
  startNative(): Promise<void>;
  licenseState(): Promise<{
    licensingReady: boolean;
    fullNavigationLicensed: boolean;
    heavyTruckLicensed: boolean;
  }>;
  mapState(config: CopilotConfiguration): Promise<CopilotMapInventory>;
  readyToAddStops(): Promise<boolean>;
}
export const copilotEvents = [
  'onCPStartup',
  'onCPShutdown',
  'licenseMgtCredentialHook',
  'mapRegionUpgradeKeyHook',
  'onLicensingReady',
  'onLicenseMgtLogin',
  'onFeatureActivated',
  'onReadyToAddStops',
  'onMapdataUpdate',
  'onMapDownloadResponse',
  'onReadyToDownloadInitialMapData',
  'onStopsAdded',
  'onStopsDeleted',
  'onStartRouteCalculation',
  'onCompleteRouteCalculation',
  'onFailedRouteCalculation',
  'onRouteCalculation',
  'onRouteSyncError',
  'onRouteSyncIntegrated',
  'onOutOfRoute',
  'onRejoinRoute',
  'onStartAlternateRouteCalculation',
  'onTurnInstructionEvent',
  'onETAChanged',
  'onEstimatedTravelTimeUpdated',
  'onDistanceToDestinationUpdated',
  'onPositionUpdate',
  'onSpeedLimitChanged',
  'onShowLaneAssist',
  'onHideLaneAssist',
  'onArrivedAtStop',
  'onTruckRestricted',
  'onTruckWarningUpdate',
  'onEnvironmentalZone',
  'onPedestrianLink',
] as const;
export function initialCopilotState(): CopilotState {
  return {
    phase: 'NOT_STARTED',
    error: null,
    operation: null,
    modules: {},
    initialized: false,
    licensingReady: false,
    fullNavigationLicensed: false,
    heavyTruckLicensed: false,
    mapsReady: false,
    readyToAddStops: false,
    copilotReady: false,
    maps: null,
    warning: null,
    lastEvent: null,
  };
}

/** Readiness observer only. It never adds stops, applies a partial profile or enables guidance. */
export class CopilotLifecycle {
  private state = initialCopilotState();
  private removers: (() => void)[] = [];
  private config: CopilotConfiguration | null = null;
  private active = false;
  private generation = 0;
  private revision = 0;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly port: CopilotLifecyclePort,
    private readonly changed: (state: CopilotState) => void,
  ) {}
  snapshot(): CopilotState {
    return this.state;
  }
  private publish(patch: Partial<CopilotState>) {
    this.state = { ...this.state, ...patch };
    this.state.copilotReady =
      !this.state.error &&
      this.state.initialized &&
      this.state.licensingReady &&
      this.state.fullNavigationLicensed &&
      this.state.heavyTruckLicensed &&
      this.state.mapsReady &&
      this.state.readyToAddStops;
    this.changed(this.state);
  }
  private fail(code: CopilotErrorCode, operation: string) {
    this.publish({
      phase: code === 'COPILOT_MAP_DATA_REQUIRED' ? 'MAPS_REQUIRED' : 'ERROR',
      error: code,
      operation,
    });
  }
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.state = initialCopilotState();
    this.config = null;
    const generation = ++this.generation;
    try {
      const modules = this.port.modules();
      this.publish({ modules });
      if (
        !Object.values(modules).length ||
        Object.values(modules).some(value => !value)
      ) {
        this.fail('COPILOT_NOT_INITIALIZED', 'native-modules');
        return;
      }
      // Subscribe before provisioning hooks or startup can cause any native event.
      for (const event of copilotEvents)
        this.removers.push(this.port.listen(event, () => this.event(event)));
      this.publish({ phase: 'STARTING' });
      const config = await this.port.prepareProvisioning();
      if (!this.active || generation !== this.generation) return;
      this.config = config;
      if (!this.config) {
        this.fail(
          'COPILOT_LICENSE_PROVISIONING_REQUIRED',
          'secure-provisioning',
        );
        return;
      }
      this.startupTimer = setTimeout(() => {
        if (this.active && !this.state.initialized)
          this.fail('COPILOT_NOT_INITIALIZED', 'startup-timeout');
      }, 30000);
      await this.port.startNative();
      // A void bind call is not initialization evidence. Await onCPStartup.
    } catch {
      if (this.active && generation === this.generation)
        this.fail('COPILOT_NOT_INITIALIZED', 'startup');
    }
  }
  private event(event: string) {
    if (!this.active) return;
    this.publish({ lastEvent: event });
    if (event === 'onCPShutdown') {
      ++this.revision;
      clearTimeout(this.startupTimer);
      this.publish({
        initialized: false,
        licensingReady: false,
        fullNavigationLicensed: false,
        heavyTruckLicensed: false,
        mapsReady: false,
        readyToAddStops: false,
        maps: null,
      });
      this.fail('COPILOT_NOT_INITIALIZED', 'shutdown');
      return;
    }
    if (
      [
        'onTruckRestricted',
        'onTruckWarningUpdate',
        'onEnvironmentalZone',
        'onPedestrianLink',
      ].includes(event)
    ) {
      this.publish({
        warning:
          'CoPilot reported a commercial road restriction. Stop safely and review the restriction before proceeding.',
      });
    }
    if (event === 'onFailedRouteCalculation' || event === 'onRouteSyncError') {
      this.fail('COPILOT_ROUTE_FAILED', event);
      return;
    }
    if (!this.config) return;
    if (event === 'onCPStartup') {
      clearTimeout(this.startupTimer);
      this.publish({
        initialized: true,
        phase: 'LICENSING',
        error: null,
        operation: null,
      });
    }
    if (
      [
        'onCPStartup',
        'onLicensingReady',
        'onLicenseMgtLogin',
        'onFeatureActivated',
        'onReadyToAddStops',
        'onMapdataUpdate',
        'onMapDownloadResponse',
      ].includes(event)
    ) {
      // Invalidate readiness immediately; never retain READY while rechecking maps/licenses.
      const revision = ++this.revision;
      this.publish({
        copilotReady: false,
        mapsReady: false,
        readyToAddStops: false,
      });
      this.queue = this.queue.then(() => this.refresh(revision));
    }
  }
  private async refresh(revision: number): Promise<void> {
    const current = () => this.active && revision === this.revision;
    if (!current() || !this.config) return;
    try {
      const license = await this.port.licenseState();
      if (!current()) return;
      this.publish(license);
      if (
        !license.licensingReady ||
        !license.fullNavigationLicensed ||
        !license.heavyTruckLicensed
      ) {
        this.fail(
          'COPILOT_LICENSE_PROVISIONING_REQUIRED',
          'license-entitlements',
        );
        return;
      }
      const maps = await this.port.mapState(this.config);
      if (!current()) return;
      this.publish({ maps, mapsReady: maps.mapsReady });
      if (!maps.mapsReady) {
        this.fail('COPILOT_MAP_DATA_REQUIRED', 'installed-licensed-maps');
        return;
      }
      const readyToAddStops = await this.port.readyToAddStops();
      if (!current()) return;
      this.publish({ readyToAddStops });
      if (!this.state.initialized || !readyToAddStops) {
        this.fail('COPILOT_NOT_READY', 'ready-to-add-stops');
        return;
      }
      // Readiness refresh must not erase a route/guidance failure.
      if (
        this.state.error === 'COPILOT_ROUTE_FAILED' ||
        this.state.error === 'COPILOT_GUIDANCE_UNAVAILABLE'
      )
        return;
      this.publish({ phase: 'READY', error: null, operation: null });
    } catch {
      if (current()) this.fail('COPILOT_NOT_READY', 'readiness-query');
    }
  }
  validateTruckProfile(profile: unknown) {
    const assessment = assessCopilotTruckProfile(profile);
    if (!assessment.canApply) {
      this.fail('COPILOT_TRUCK_PROFILE_INVALID', 'truck-profile');
      throw new CopilotP0Error('COPILOT_TRUCK_PROFILE_INVALID');
    }
    if (!this.state.copilotReady)
      throw new CopilotP0Error(this.state.error ?? 'COPILOT_NOT_READY');
    return assessment;
  }
  requireRoutePermission(profile: unknown): never {
    this.validateTruckProfile(profile);
    // Exact backend-route parity has not been established with this CPIK delivery.
    this.fail('COPILOT_ROUTE_FAILED', 'REQUIRES_TRIMBLE_CONFIRMATION');
    throw new CopilotP0Error('COPILOT_ROUTE_FAILED');
  }
  requireGuidancePermission(): never {
    this.fail('COPILOT_GUIDANCE_UNAVAILABLE', 'no-verified-copilot-route');
    throw new CopilotP0Error('COPILOT_GUIDANCE_UNAVAILABLE');
  }
  dispose() {
    this.active = false;
    ++this.generation;
    ++this.revision;
    clearTimeout(this.startupTimer);
    for (const remove of this.removers.splice(0)) remove();
    // Removing JS observers must not repeatedly stop/restart the native service.
  }
}
