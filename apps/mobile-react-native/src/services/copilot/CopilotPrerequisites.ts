import {
  CopilotP0Error,
  parseCopilotConfiguration,
} from './CopilotConfiguration';

export type CopilotEvidence = {
  nativeBuildVerified: boolean;
  modulePresent: boolean;
  startup: 'not-started' | 'starting' | 'started' | 'failed' | 'shutdown';
  failure?: { operation: string; error: unknown };
  credentialProvisioned: boolean;
  licensingReady: boolean;
  fullNavigationLicensed: boolean;
  heavyTruckLicensed: boolean;
  licensedMapRegions: readonly string[];
  installedMaps: readonly {
    regionConstant: string;
    year: number;
    quarter: number;
    version: string;
    installation: 'downloading' | 'installed' | 'failed';
  }[];
  gpsPermission: 'precise' | 'approximate' | 'denied' | 'unknown';
};

/** Evidence supplied by the future native adapter; never generates SDK events,
 * starts a service, downloads maps, or declares navigation active. */
export function requireCopilotProfilePrerequisites(
  value: unknown,
  evidence: CopilotEvidence,
): void {
  if (evidence.failure) {
    throw new CopilotP0Error(
      'CPIK_ERROR',
      [evidence.failure.operation],
      evidence.failure.error,
    );
  }
  const config = parseCopilotConfiguration(value);
  if (!evidence.nativeBuildVerified) {
    throw new CopilotP0Error('NATIVE_BUILD_UNVERIFIED');
  }
  if (!evidence.modulePresent) {
    throw new CopilotP0Error('NATIVE_MODULE_UNAVAILABLE');
  }
  if (!evidence.credentialProvisioned) {
    throw new CopilotP0Error('CREDENTIAL_UNAVAILABLE');
  }
  if (evidence.startup !== 'started') {
    throw new CopilotP0Error(
      'STARTUP_' + evidence.startup.toUpperCase().replace('-', '_'),
    );
  }
  if (
    !evidence.licensingReady ||
    !evidence.fullNavigationLicensed ||
    !evidence.heavyTruckLicensed
  ) {
    throw new CopilotP0Error('TRUCK_NAVIGATION_UNLICENSED');
  }
  if (!evidence.licensedMapRegions.includes(config.mapRegionConstant)) {
    throw new CopilotP0Error('MAP_REGION_UNLICENSED');
  }
  const installed = evidence.installedMaps.some(
    map =>
      map.regionConstant === config.mapRegionConstant &&
      map.installation === 'installed' &&
      map.year === config.mapVersion.year &&
      map.quarter === config.mapVersion.quarter &&
      map.version === config.mapVersion.version,
  );
  if (!installed) {
    throw new CopilotP0Error('REQUIRED_MAP_UNAVAILABLE');
  }
  if (evidence.gpsPermission !== 'precise') {
    throw new CopilotP0Error('PRECISE_LOCATION_UNAVAILABLE');
  }
  // Passing this gate only permits profile validation. It is not permission
  // to calculate a route or activate navigation; profile parity is still blocked.
}
