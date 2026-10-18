import { z } from 'zod';
import { amsLoginFailures } from './CopilotLicenseDiagnostics';

export const mapDownloadResponses = [
  'NOT_REQUESTED',
  'NOT_RECEIVED',
  'NATIVE_EXCEPTION',
  'BLOCKED',
  'FAILURE_PREPROCESSING',
  'WAITING_ON_STORAGE_SPACE',
  'INSTALLED',
  'SUCCESS',
  'FAILURE_INVALID_CONNECTION',
  'FAILURE_INVALID_ARGUMENT',
  'FAILURE_MANAGER_BUSY',
  'FAILURE_VALIDATION',
  'FAILURE_VERSION',
  'FAILURE_INSTALLED',
  'FAILURE_DOWNLOADING',
  'FAILURE_DOWNLOADED',
  'FAILURE_PAUSED',
  'FAILURE_CANCELLED',
  'FAILURE_UNLICENSED',
  'FAILURE_ENQUEUE',
  'FAILURE_INSUFFICIENT_DISK_SPACE',
  'FAILURE_PREINSTALLED',
  'FAILURE_MAPUPTODATE',
  'FAILED_GENERIC_ERROR',
];
const responses = [
  'NOT_RECEIVED',
  'SUCCESS',
  'FAILED_LOGIN_WILL_EXPIRE',
  ...amsLoginFailures,
];
const events = [
  'START_REQUEST',
  'START_REUSED',
  'HOOK_REGISTERED',
  'SERVICE_BIND_REQUEST',
  'SERVICE_CONNECTED',
  'SERVICE_DISCONNECTED',
  'STARTUP_CALLBACK',
  'STARTUP_PUBLISHED',
  'DEVICE_WRITE_REQUEST',
  'DEVICE_WRITE_RETURNED',
  'DEVICE_READBACK_PENDING',
  'DEVICE_READBACK_VERIFIED',
  'DEVICE_READBACK_FAILED',
  'DEVICE_CONFIGURATION_FAILED',
  'CREDENTIAL_HOOK',
  'LOGIN_CALLBACK',
  'SHUTDOWN_CALLBACK',
  'STARTUP_FAILED',
  'STARTUP_TIMEOUT',
  'SERVICE_RELEASED',
  'REPORT_REQUEST',
];
const fixedCode = (allowed: readonly string[]) =>
  z
    .unknown()
    .transform(value =>
      typeof value === 'string' && allowed.includes(value)
        ? value
        : 'NOT_AVAILABLE',
    );
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const snapshot = z.object({
  buildIdentity: z
    .object({
      commit: z.string().regex(/^(?:[a-f0-9]{40}|local-unverified)$/),
      builtAt: z.string().datetime(),
      packageName: z.literal('com.semitrax.app.recovery.hybrid'),
      variant: z.literal('debug'),
      versionCode: count,
      versionName: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    })
    .optional(),
  controlTimeline: z
    .array(
      z.object({
        action: fixedCode([
          'START_RESUME',
          'TRUCK_SETTINGS',
          'END_ROUTE',
          'BACK',
          'READINESS',
          'SYNC_PROFILE',
          'START',
          'RESUME',
        ]),
        stage: fixedCode([
          'PRESS',
          'VALIDATING',
          'NATIVE_CALL',
          'CONFIRMED',
          'FAILED',
          'BUSY',
          'REQUEST',
          'BLOCKED_UNSUPPORTED_RESTRICTIONS',
        ]),
        elapsedMs: count,
        engineStarted: z.boolean(),
        serviceConnected: z.boolean(),
      }),
    )
    .max(64)
    .optional(),
  reportBuild: fixedCode([
    'ams-trace-v1',
    'ams-trace-v2',
    'ams-testasset-v2',
    'maps-diag-v3',
    'maps-storage-v4',
    'hybrid-issue392-v1',
  ]),
  nativeDisplay: z
    .object({
      status: fixedCode(['AVAILABLE', 'PARTIAL', 'NOT_STARTED']),
      deviceUtcOffsetMinutes: z.number().int().min(-840).max(840),
      headingDisplayEnabled: z.boolean().optional(),
      speedLimitOnMap: z.boolean().optional(),
      poiAlertsEnabled: z.boolean().optional(),
      poiAlertDistance: fixedCode([
        'TWOTENTHS_MILE',
        'HALF_MILE',
        'ONE_MILE',
        'THREE_MILES',
        'TEN_MILES',
        'TWENTYFIVE_MILES',
        'HALF_KILOMETER',
        'ONE_KILOMETER',
        'TWO_KILOMETERS',
        'FIVE_KILOMETERS',
        'SIXTEEN_KILOMETERS',
        'FORTY_KILOMETERS',
      ]).optional(),
      poiAlertCategoryCount: count.optional(),
      poiDisplayedCategoryCount: count.optional(),
      etaMinutesFromNow: z.number().finite().optional(),
    })
    .optional(),
  appStorage: z
    .union([
      z
        .object({
          status: z.literal('AVAILABLE'),
          availableBytes: count,
          totalBytes: count,
        })
        .refine(value => value.availableBytes <= value.totalBytes),
      z.object({ status: z.literal('UNAVAILABLE') }),
    ])
    .optional(),
  mapDownload: z
    .object({
      response: fixedCode(mapDownloadResponses),
      callback: fixedCode(mapDownloadResponses),
      status: fixedCode([
        'STATUS_UNKNOWN',
        'DOWNLOADING',
        'SUCCEEDED',
        'CANCELLED',
        'FAILED',
        'PAUSED',
        'NOT_INITIATED',
        'WAITING_ON_STORAGE_SPACE',
        'INSTALLATION_STARTED',
        'INSTALLATION_FINISHED',
      ]),
      stage: fixedCode([
        'NOT_REQUESTED',
        'IDENTITY_CHECK',
        'FOREGROUND_CHECK',
        'ROUTE_CHECK',
        'LICENSE_CHECK',
        'INVENTORY_CHECK',
        'REGION_CHECK',
        'NETWORK_POLICY',
        'SDK_REQUEST',
        'CATALOG_IDENTITY_CHECK',
        'CATALOG_SDK_REQUEST',
        'SDK_RESPONSE',
        'APP_REQUEST_BUSY',
        'CATALOG_REQUEST_FAILED',
        'CATALOG_VALIDATION_FAILED',
        'COMPLETE',
      ]),
      attempts: count,
      cellularAllowed: z.boolean(),
      initialMapSignalReceived: z.boolean(),
    })
    .optional(),
  androidApi: count.optional(),
  sdkVersion: z
    .unknown()
    .transform(value =>
      typeof value === 'string' &&
      /^[0-9]+(?:\.[0-9]+){1,4}$/.test(value) &&
      value.length <= 32
        ? value
        : 'NOT_AVAILABLE',
    ),
  savedCompanyMatches: z.boolean(),
  savedDeviceMatches: z.boolean(),
  credentialHook: fixedCode([
    'NOT_CALLED',
    'SUPPLY_ASSIGNED',
    'NO_ASSIGNMENT',
    'PRESERVE_OTHER_ACCOUNT',
    'QUERY_FAILED',
    'DEVICE_CONFIGURATION_FAILED',
  ]),
  hookMatchedAssigned: z.boolean(),
  callbackMatchedAssigned: z.boolean(),
  loginResponse: fixedCode(responses),
  deviceConfigured: z.boolean().optional(),
  deviceConfigurationStatus: fixedCode([
    'WAITING_FOR_STARTUP',
    'WAITING_FOR_READBACK',
    'VERIFIED',
    'READBACK_MISMATCH',
    'NATIVE_CONFIGURATION_UNAVAILABLE',
    'NATIVE_READBACK_UNAVAILABLE',
    'SDK_CONFIGURATION_ERROR',
  ]),
  deviceReadbackKind: fixedCode([
    'NOT_READ',
    'NO_STRING_VALUE',
    'EMPTY',
    'MATCH',
    'DIFFERENT',
  ]),
  engineStarted: z.boolean().optional(),
  serviceBound: z.boolean().optional(),
  serviceConnected: z.boolean().optional(),
  droppedEvents: count.optional(),
  timeline: z
    .array(
      z.object({
        sequence: count,
        elapsedMs: count,
        event: fixedCode(events),
        started: z.boolean(),
        deviceVerified: z.boolean(),
        response: fixedCode(responses),
      }),
    )
    .max(96)
    .optional(),
});
const readiness = z.object({
  phase: fixedCode([
    'NOT_STARTED',
    'STARTING',
    'LICENSING',
    'MAPS_REQUIRED',
    'READY',
    'ERROR',
  ]),
  initialized: z.boolean(),
  licensingReady: z.boolean(),
  fullNavigationLicensed: z.boolean(),
  heavyTruckLicensed: z.boolean(),
  mapsReady: z.boolean(),
});

/** Project explicit fields before export; raw native/JS payloads never enter the report. */
export function coPilotDiagnosticReport(
  native: unknown,
  state: unknown,
): string {
  const data = snapshot.parse(native);
  const checks = readiness.parse(state);
  return [
    'SEMITRAX_COPILOT_DIAG_V1',
    `Captured at (UTC): ${new Date().toISOString()}`,
    'Native SDK callback timeline and setup checks; not an internal server/network log.',
    'Elapsed times are milliseconds since this native host was created, oldest first.',
    'START_REUSED means a setup check reused the running engine; it did not send a fresh login.',
    'No credentials, account IDs, serial numbers, location or raw exception messages included.',
    JSON.stringify({ native: data, readiness: checks }, null, 2),
  ].join('\n\n');
}
