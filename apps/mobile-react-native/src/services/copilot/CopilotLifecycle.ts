import {
  amsDiagnosticCodes,
  retryAmsFailure,
} from './CopilotLicenseDiagnostics';
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
  /** Reload exact SDK inventory version after startup or map installation. */
  configuration?(): Promise<CopilotConfiguration | null>;
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
  private startupRejected = false;
  private generation = 0;
  private revision = 0;
  private readinessRetries = 0;
  private readinessTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.startupRejected = false;
    this.state = initialCopilotState();
    this.config = null;
    this.readinessRetries = 0;
    clearTimeout(this.readinessTimer);
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
        if (
          this.active &&
          generation === this.generation &&
          !this.state.initialized
        ) {
          this.startupRejected = true;
          ++this.revision;
          this.fail('COPILOT_NOT_INITIALIZED', 'startup-timeout');
        }
      }, 30000);
      await this.port.startNative();
      // A void bind call is not initialization evidence. Await onCPStartup.
    } catch (error) {
      if (this.active && generation === this.generation) {
        this.startupRejected = true;
        ++this.revision;
        clearTimeout(this.startupTimer);
        // Only allow known native codes; never expose SDK text or account identifiers.
        const nativeCode = (error as { code?: unknown } | null)?.code;
        const safeCodes = [
          'COPILOT_STARTUP_TIMEOUT',
          'COPILOT_VIEW_UNAVAILABLE',
          'COPILOT_MAP_POLICY_FAILED',
          'COPILOT_GUIDANCE_SUSPEND_FAILED',
          'COPILOT_FOREGROUND_FAILED',
          'COPILOT_SERVICE_DISCONNECTED',
          'COPILOT_INVALID_BINDING',
          'COPILOT_NATIVE_STARTUP_FAILED',
          'COPILOT_SECURE_RESTORE_FAILED',
          'COPILOT_PRECISE_LOCATION_REQUIRED',
          'COPILOT_FOREGROUND_ACTIVITY_REQUIRED',
          'COPILOT_DEVICE_SETUP_REQUIRED',
        ];
        this.fail(
          'COPILOT_NOT_INITIALIZED',
          typeof nativeCode === 'string' && safeCodes.includes(nativeCode)
            ? nativeCode
            : 'startup',
        );
      }
    }
  }
  private event(event: string) {
    if (!this.active || this.startupRejected) return;
    this.publish({ lastEvent: event });
    if (event === 'onCPShutdown') {
      // A shutdown ends this native startup attempt. Only a fresh lifecycle
      // start may accept a subsequent onCPStartup callback.
      this.startupRejected = true;
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
      // Cancel any in-flight license/map refresh. Its delayed results must not
      // restore READY after a safety-critical route failure.
      ++this.revision;
      this.fail('COPILOT_ROUTE_FAILED', event);
      return;
    }
    // Only onCPStartup establishes initialization. Native callbacks arriving
    // before startup must not query licensing or mark CoPilot ready.
    if (!this.state.initialized && event !== 'onCPStartup') return;
    if (!this.config) return;
    // Duplicate startup notifications are not evidence that an existing
    // failed route has become safe. Only the first startup can initialize.
    if (event === 'onCPStartup' && this.state.initialized) return;
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
        'onReadyToDownloadInitialMapData',
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
  private retryReadiness(revision: number) {
    if (this.readinessRetries >= 6 || this.readinessTimer) return;
    ++this.readinessRetries;
    this.readinessTimer = setTimeout(() => {
      this.readinessTimer = undefined;
      if (
        !this.active ||
        this.startupRejected ||
        revision !== this.revision ||
        !this.state.initialized
      )
        return;
      this.queue = this.queue.then(() => this.refresh(revision));
    }, 5000);
  }
  private async refresh(revision: number): Promise<void> {
    const current = () => this.active && revision === this.revision;
    if (!current() || !this.config) return;
    clearTimeout(this.readinessTimer);
    this.readinessTimer = undefined;
    let stage = 'license-verification';
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
        if (!license.licensingReady) this.retryReadiness(revision);
        return;
      }
      stage = 'map-version-inventory';
      if (this.port.configuration) {
        const configuration = await this.port.configuration();
        if (!current()) return;
        if (!configuration) {
          this.fail('COPILOT_LICENSE_PROVISIONING_REQUIRED', 'secure-restore');
          return;
        }
        this.config = configuration;
      }
      stage = 'installed-map-inventory';
      const maps = await this.port.mapState(this.config);
      if (!current()) return;
      this.publish({ maps, mapsReady: maps.mapsReady });
      if (!maps.mapsReady) {
        this.fail('COPILOT_MAP_DATA_REQUIRED', 'installed-licensed-maps');
        return;
      }
      stage = 'route-manager-readiness';
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
      clearTimeout(this.readinessTimer);
      this.readinessTimer = undefined;
      this.publish({ phase: 'READY', error: null, operation: null });
    } catch (error) {
      const nativeCode = (error as { code?: unknown } | null)?.code;
      const safeCodes = [
        ...amsDiagnosticCodes,
        'COPILOT_IDENTITY_UNVERIFIED',
        'COPILOT_LICENSE_QUERY_FAILED',
        'COPILOT_AMS_ENGINE_NOT_STARTED',
        'COPILOT_AMS_IDENTITY_QUERY_FAILED',
        'COPILOT_AMS_IDENTITY_MISSING',
        'COPILOT_AMS_COMPANY_MISMATCH',
        'COPILOT_AMS_DEVICE_MISMATCH',
        'COPILOT_INVENTORY_FAILED',
        'COPILOT_SECURE_RESTORE_FAILED',
        'CONFIGURATION_INVALID',
      ];
      if (current()) {
        this.fail(
          'COPILOT_NOT_READY',
          typeof nativeCode === 'string' && safeCodes.includes(nativeCode)
            ? `${stage}: ${nativeCode}`
            : stage,
        );
        if (
          stage !== 'route-manager-readiness' &&
          nativeCode !== 'CONFIGURATION_INVALID' &&
          nativeCode !== 'COPILOT_SECURE_RESTORE_FAILED' &&
          retryAmsFailure(nativeCode)
        )
          this.retryReadiness(revision);
      }
    }
  }
  /** Explicit inventory query; never synthesizes an SDK startup/download event. */
  async recheck(): Promise<void> {
    if (!this.active || this.startupRejected || !this.state.initialized) return;
    const revision = ++this.revision;
    this.publish({ mapsReady: false, readyToAddStops: false });
    this.queue = this.queue.then(() => this.refresh(revision));
    await this.queue;
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
    this.startupRejected = false;
    ++this.generation;
    ++this.revision;
    clearTimeout(this.startupTimer);
    clearTimeout(this.readinessTimer);
    this.readinessTimer = undefined;
    for (const remove of this.removers.splice(0)) remove();
    // Removing JS observers must not repeatedly stop/restart the native service.
  }
}
