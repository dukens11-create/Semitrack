import { ZodError } from 'zod';
const messages: Record<string, string> = {
  TRIMBLE_RESTRICTION_WARNING: 'The provider reported a restriction or warning on this route. Review your truck profile and choose another destination or stop; do not follow an unverified route.',
  TRUCK_PROFILE_CHANGED: 'Your saved truck profile changed. Refresh and verify it before routing.',
  TRIMBLE_REQUEST_INVALID: 'Review the truck profile and stops before requesting a route.',
  TRIMBLE_RESTRICTION_UNSUPPORTED: 'The routing provider cannot guarantee one or more selected road avoidances. Review your route preferences; do not remove a restriction your vehicle requires.',
  TRIMBLE_MANEUVER_DATA_REQUIRED: 'The route instructions are incomplete. A safe truck route cannot be displayed.',
  INVALID_RESPONSE: 'SemiTraX returned information that could not be validated. Please try again.',
  CONFIGURATION_INVALID: 'SemiTraX configuration is unavailable.',
  NAVIGATION_UNAVAILABLE: 'Navigation is unavailable until its safety checks are complete.',
  VERIFIED_TRUCK_REQUIRED: 'Create and select a verified truck profile first.',
  GPS_PERMISSION_REQUIRED: 'Allow precise location while using SemiTraX. If permission was denied, enable it in Android or iOS app settings.',
  GPS_UNAVAILABLE: 'Location updates stopped. Enable device location and retry while SemiTraX is open.',
  GPS_ACQUISITION_TIMEOUT: 'A fresh precise GPS fix was not received. Move to an open area, check precise location access, and retry.',
  FRESH_LOCATION_REQUIRED:
    'A fresh precise GPS fix is required. Enable location and retry.',
  ROUTE_CONTRACT_INVALID:
    'Unable to prepare this truck route. Please try again or choose another destination.',
  VALIDATION_ERROR: 'Please review the information you entered and try again.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  EMAIL_IN_USE: 'An account already uses this email address. Try signing in.',
  NETWORK_UNAVAILABLE:
    'Unable to reach SemiTraX. Check your connection and retry.',
  REQUEST_TIMEOUT: 'SemiTraX took too long to respond. Please try again.',
  REQUEST_CANCELLED: 'The request was cancelled.',
  SESSION_CHANGED: 'Your session changed. Please sign in again.',
  DATABASE_UNAVAILABLE:
    'Account services are temporarily unavailable. Please try again shortly.',
  TRIMBLE_QUOTA_EXCEEDED:
    'Truck routing is temporarily unavailable. Please try again later.',
  TRIMBLE_ROUTE_UNAVAILABLE:
    'No suitable truck route was returned. Check your truck profile and destination.',
  TRIMBLE_MANEUVER_COORDINATE_REQUIRED:
    'This truck route could not be matched safely to the map. Try another destination.',
  TRIMBLE_MANEUVER_GEOMETRY_MISMATCH:
    'This truck route could not be matched safely to the map. Try another destination.',
  LAST_TRUCK:
    'Keep at least one saved truck profile. Create another before deleting this one.',
  TRUCK_NOT_FOUND:
    'This truck profile is no longer available. Refresh your profiles.',
};
export type ErrorCategory = 'validation' | 'authentication' | 'network' | 'routing' | 'truckProfile' | 'provider' | 'configuration' | 'navigation';
export class DriverError extends Error {
  constructor(readonly code: string, readonly category: ErrorCategory = 'validation') {
    super(
      messages[code] ?? 'Unable to complete this request. Please try again.',
    );
  }
}
/** Only local, reviewed copy reaches UI. Server text, schema issues and stacks never do. */
export function safeDriverError(
  error: unknown,
  fallback = 'Unable to complete this request. Please try again.',
): string {
  if (error instanceof ZodError)
    return 'The returned information could not be validated. Please review your entries or try again.';
  if (error && typeof error === 'object') {
    const detail = error as { code?: unknown; status?: unknown };
    if (typeof detail.code === 'string' && Object.hasOwn(messages, detail.code))
      return messages[detail.code]!;
    if (detail.status === 401) return 'Please sign in again to continue.';
    if (detail.status === 403)
      return 'This action is not available for your account.';
    if (detail.status === 409)
      return 'This information changed. Refresh it and review before trying again.';
    if (detail.status === 429)
      return 'Too many requests. Please wait and try again.';
    if (typeof detail.status === 'number' && detail.status >= 500)
      return 'SemiTraX is temporarily unavailable. Please try again later.';
  }
  return fallback;
}

export class ValidationError extends DriverError { constructor() { super('VALIDATION_ERROR', 'validation'); } }
export class AuthenticationError extends DriverError { constructor() { super('SESSION_CHANGED', 'authentication'); } }
export class NetworkError extends DriverError { constructor() { super('NETWORK_UNAVAILABLE', 'network'); } }
export class RoutingUnavailableError extends DriverError { constructor() { super('ROUTE_CONTRACT_INVALID', 'routing'); } }
export class TruckProfileError extends DriverError { constructor() { super('VERIFIED_TRUCK_REQUIRED', 'truckProfile'); } }
export class ProviderError extends DriverError { constructor() { super('INVALID_RESPONSE', 'provider'); } }
export class ConfigurationError extends DriverError { constructor() { super('CONFIGURATION_INVALID', 'configuration'); } }
export class NavigationUnavailableError extends DriverError { constructor() { super('NAVIGATION_UNAVAILABLE', 'navigation'); } }
