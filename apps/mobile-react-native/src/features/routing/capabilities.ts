import { z } from 'zod';
export const capabilitiesSchema = z.object({
  contractVersion: z.literal('rn-p0-v1'),
  truckRouting: z.object({
    provider: z.literal('Trimble'),
    status: z.enum([
      'OPERATIONAL',
      'DEGRADED',
      'UNAVAILABLE',
      'NOT_CONFIGURED',
    ]),
    state: z.enum([
      'PLANNING_AVAILABLE',
      'PLANNING_UNVERIFIED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_MISCONFIGURED',
    ]),
    requestAllowed: z.boolean(),
    verifiedProfileRequired: z.literal(true),
    validUntil: z.string().nullable(),
  }),
  turnByTurn: z.object({
    available: z.literal(false),
    state: z.literal('UNAVAILABLE'),
    licenseStatus: z.literal('UNVERIFIED'),
  }),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export function planningStatus(input: {
  verified: boolean;
  phase: string;
  errorCode?: string;
  capabilities?: Capabilities;
  now?: number;
}) {
  if (input.errorCode === 'TRUCK_PROFILE_CHANGED')
    return 'Truck profile changed — review and verify it again';
  if (!input.verified || input.errorCode === 'VERIFIED_TRUCK_REQUIRED')
    return 'Truck profile verification required';
  if (
    input.errorCode &&
    [
      'TRIMBLE_API_KEY_MISSING',
      'TRIMBLE_AUTHORIZATION_FAILED',
      'TRIMBLE_CONFIGURATION_INVALID',
    ].includes(input.errorCode)
  )
    return 'Trimble routing configuration needs attention';
  if (
    input.errorCode &&
    [
      'TRIMBLE_NETWORK_ERROR',
      'TRIMBLE_REQUEST_TIMEOUT',
      'TRIMBLE_HTTP_ERROR',
      'TRIMBLE_QUOTA_EXCEEDED',
    ].includes(input.errorCode)
  )
    return 'Trimble routing temporarily unavailable';
  if (input.phase === 'calculating' || input.phase === 'rerouting')
    return 'Calculating a Trimble truck route';
  if (input.errorCode === 'TRIMBLE_RESTRICTION_WARNING')
    return 'Truck route not verified — provider warning requires review';
  if (input.errorCode === 'TRIMBLE_RESTRICTION_UNSUPPORTED')
    return 'Selected road avoidance cannot be guaranteed';
  if (input.phase === 'error')
    return 'Route calculation failed — review the error and retry';
  if (input.phase === 'preview')
    return 'Truck route calculated · Navigation not started';
  const route = input.capabilities?.truckRouting;
  if (route?.state === 'PROVIDER_MISCONFIGURED')
    return 'Trimble routing configuration needs attention';
  if (route?.state === 'PROVIDER_UNAVAILABLE')
    return 'Trimble routing temporarily unavailable';
  const fresh =
    route?.validUntil &&
    Date.parse(route.validUntil) > (input.now ?? Date.now());
  if (route?.status === 'OPERATIONAL' && fresh)
    return 'Truck route planning available · Choose a destination';
  return 'Choose a destination · Trimble provider health unverified';
}
