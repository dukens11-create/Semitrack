import { z } from 'zod';
import { amsLoginFailures } from './CopilotLicenseDiagnostics';

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
  reportBuild: fixedCode(['ams-trace-v1']),
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
