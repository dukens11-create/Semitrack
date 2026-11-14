import {
  truckProfileBlockers,
  type TruckProfileBlocker,
} from './TruckProfileBlockers';
const allowed = [
  'COPILOT_NOT_READY',
  'TRUCK_NOT_SELECTED',
  'SAVED_TRUCK_INVALID',
  'STANDARD_TRUCK_SCOPE',
  'PROFILE_BRIDGE_MISSING',
  'FLEET_PROFILE_REQUIRED',
  'TRUCK_DIMENSIONS_MISMATCH',
  'TRUCK_PREFERENCES_MISMATCH',
  'STANDARD_TRUCK_RECHECK_REQUIRED',
  'STANDARD_TRUCK_CONFIRMATION_REQUIRED',
  'STANDARD_TRUCK_UNSUPPORTED',
  'ENGINE_STOP_UNCONFIRMED',
  'ENGINE_TRIP_TIMEOUT',
  'ENGINE_GEOCODE_BUSY',
  'ENGINE_ROUTE_UNCONFIRMED',
  'ENGINE_TRIP_CANCELLED',
  'ENGINE_TRIP_FAILED',
  'ENGINE_TRIP_UNAVAILABLE',
  'COPILOT_MAP_OR_LICENSE_UNVERIFIED',
] as const;
let lastFailure: {
  action: string;
  code: string;
  profileBlockers?: TruckProfileBlocker[];
} | null = null;
export function recordHybridFailure(action: string, error: unknown) {
  const actions = [
    'START_RESUME',
    'TRUCK_SETTINGS',
    'END_ROUTE',
    'BACK',
    'READINESS',
    'SYNC_PROFILE',
  ];
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  lastFailure = {
    action: actions.includes(action) ? action : 'UNKNOWN_ACTION',
    code:
      typeof code === 'string' && (allowed as readonly string[]).includes(code)
        ? code
        : 'UNCLASSIFIED_FAILURE',
  };
  if (
    lastFailure.code === 'STANDARD_TRUCK_SCOPE' &&
    error &&
    typeof error === 'object' &&
    'profileBlockers' in error &&
    Array.isArray(error.profileBlockers)
  ) {
    const supplied: unknown[] = error.profileBlockers;
    lastFailure.profileBlockers = truckProfileBlockers.filter(blocker =>
      supplied.includes(blocker),
    );
  }
}
export function clearHybridFailure(action: string) {
  if (lastFailure?.action === action) lastFailure = null;
}
export function hybridFailureSnapshot() {
  return lastFailure
    ? {
        ...lastFailure,
        ...(lastFailure.profileBlockers
          ? { profileBlockers: [...lastFailure.profileBlockers] }
          : {}),
      }
    : null;
}
