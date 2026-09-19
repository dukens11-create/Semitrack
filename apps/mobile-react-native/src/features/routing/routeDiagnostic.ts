import { sanitizeRestrictionDiagnostic } from './restrictionDiagnostic';
import { safeDriverError } from '../../errors/driverErrors';
const codes = {
  TRIMBLE_RESTRICTION_WARNING: 'UNCLASSIFIED_PROVIDER_WARNING',
  TRIMBLE_RESTRICTION_UNSUPPORTED: 'UNSUPPORTED_AVOIDANCE',
  TRIMBLE_API_KEY_MISSING: 'CONFIGURATION',
  TRIMBLE_CONFIGURATION_INVALID: 'CONFIGURATION',
  TRIMBLE_AUTHORIZATION_FAILED: 'PROVIDER_AUTHENTICATION',
  TRIMBLE_NETWORK_ERROR: 'PROVIDER_UNAVAILABLE',
  TRIMBLE_REQUEST_TIMEOUT: 'PROVIDER_UNAVAILABLE',
  TRIMBLE_HTTP_ERROR: 'PROVIDER_UNAVAILABLE',
  TRIMBLE_QUOTA_EXCEEDED: 'PROVIDER_UNAVAILABLE',
  TRIMBLE_REQUEST_INVALID: 'REQUEST_VALIDATION',
  ROUTE_REQUEST_INVALID: 'REQUEST_VALIDATION',
  VALIDATION_ERROR: 'REQUEST_VALIDATION',
  VERIFIED_TRUCK_REQUIRED: 'TRUCK_PROFILE',
  TRUCK_PROFILE_CHANGED: 'TRUCK_PROFILE',
  TRIMBLE_INCOMPLETE_ROUTE: 'PROVIDER_INTEGRITY',
  TRIMBLE_INVALID_RESPONSE: 'PROVIDER_INTEGRITY',
  TRIMBLE_RESPONSE_TOO_LARGE: 'PROVIDER_INTEGRITY',
  TRIMBLE_ROUTE_GEOMETRY_INVALID: 'PROVIDER_INTEGRITY',
  TRIMBLE_ROUTE_ID_MISMATCH: 'PROVIDER_INTEGRITY',
  TRIMBLE_ALTERNATIVE_INVALID: 'PROVIDER_INTEGRITY',
  TRIMBLE_PROVIDER_REQUIRED: 'CONFIGURATION',
  TRUCK_SAFE_ROUTE_UNAVAILABLE: 'NO_VERIFIED_ROUTE',
  REQUEST_CANCELLED: 'CANCELLED',
  REQUEST_FAILED: 'BACKEND',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  TRIMBLE_MANEUVER_DATA_REQUIRED: 'PROVIDER_INTEGRITY',
  TRIMBLE_STOP_COVERAGE_UNPROVEN: 'PROVIDER_INTEGRITY',
  TRIMBLE_ROUTE_UNAVAILABLE: 'NO_VERIFIED_ROUTE',
  ROUTE_CONTRACT_INVALID: 'PROVIDER_INTEGRITY',
  NETWORK_UNAVAILABLE: 'NETWORK',
  REQUEST_TIMEOUT: 'NETWORK',
  SESSION_CHANGED: 'AUTHENTICATION',
  AUTH_EXPIRED: 'AUTHENTICATION',
  DATABASE_UNAVAILABLE: 'BACKEND',
  INVALID_RESPONSE: 'BACKEND',
} as const;
export function routeDiagnostic(error: unknown) {
  const detail =
    error && typeof error === 'object'
      ? (error as {
          code?: unknown;
          status?: unknown;
          validationFields?: unknown;
          restrictionDiagnostic?: unknown;
        })
      : {};
  const code =
    typeof detail.code === 'string' && Object.hasOwn(codes, detail.code)
      ? (detail.code as keyof typeof codes)
      : 'UNCLASSIFIED_ERROR';
  const status =
    typeof detail.status === 'number' &&
    Number.isInteger(detail.status) &&
    detail.status >= 100 &&
    detail.status <= 599
      ? detail.status
      : null;
  const category =
    code === 'UNCLASSIFIED_ERROR'
      ? status === 401 || status === 403
        ? 'AUTHENTICATION'
        : status && status >= 500
        ? 'BACKEND'
        : 'UNKNOWN'
      : codes[code];
  const fieldLabels: Record<string, string> = {
    heightFt: 'Truck height',
    widthFt: 'Truck width',
    lengthFt: 'Truck length',
    weightLbs: 'Truck weight',
    axleCount: 'Axle count',
    trailerCount: 'Trailer count',
    hazardousGoods: 'Hazmat',
    avoidHighways: 'Highway avoidance',
    avoidResidential: 'Residential avoidance',
    avoidDirtRoads: 'Unpaved-road avoidance',
  };
  const fields = Array.isArray(detail.validationFields)
    ? detail.validationFields
        .filter(
          (v): v is string =>
            typeof v === 'string' && Object.hasOwn(fieldLabels, v),
        )
        .map(v => fieldLabels[v]!)
    : [];
  const providerDetail =
    code === 'TRIMBLE_RESTRICTION_WARNING'
      ? sanitizeRestrictionDiagnostic(detail.restrictionDiagnostic)
      : null;
  return {
    code,
    category,
    httpStatus: status,
    message: fields.length
      ? fields.join(', ') + ' needs attention. Use actual truck measurements.'
      : safeDriverError(error),
    providerDetailAvailable: providerDetail !== null,
    ...(providerDetail ? { providerDetail } : {}),
  };
}
