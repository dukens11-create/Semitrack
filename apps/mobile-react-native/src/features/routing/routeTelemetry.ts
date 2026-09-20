import { MAX_ROUTE_LOCATIONS } from '../../models/routeLimits';
import { z } from 'zod';
import { routeDiagnostic } from './routeDiagnostic';

const stageSchema = z.enum([
  'REQUEST_PROFILE',
  'REQUEST_VALIDATION',
  'REQUEST_CONSTRUCTION',
  'BACKEND_HTTP',
  'BACKEND_ERROR',
  'WARNING_ORIGIN',
  'RESPONSE_PARSE',
  'DECISION',
  'UI_WARNING',
]);
export type RouteDiagnosticStage = z.infer<typeof stageSchema>;
const sourceSchema = z.enum([
  'LOCAL_VALIDATION',
  'REQUEST_CONSTRUCTION',
  'BACKEND_RESPONSE',
  'PROVIDER_RESTRICTION',
  'RESPONSE_PARSE',
  'UNKNOWN',
]);
const presence = z.enum(['PRESENT', 'MISSING']);
const schema = z.object({
  attempt: z.number().int().positive(),
  stage: stageSchema,
  source: sourceSchema.optional(),
  result: z
    .enum([
      'PENDING',
      'PASS',
      'FAIL',
      'ACCEPTED',
      'REJECTED',
      'WARNING_OBSERVED',
    ])
    .optional(),
  profile: presence.optional(),
  dimensions: presence.optional(),
  weight: presence.optional(),
  axles: presence.optional(),
  trailers: presence.optional(),
  hazmat: z.enum(['ENABLED', 'DISABLED', 'UNKNOWN']).optional(),
  stopCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_ROUTE_LOCATIONS)
    .nullable()
    .optional(),
  backendHttpStatus: z.number().int().min(100).max(599).nullable().optional(),
  responseReceived: z.boolean().optional(),
  warningEvidence: z.enum(['PRESENT', 'ABSENT_OR_INVALID']).optional(),
  providerWarningTypes: z
    .array(z.number().int().min(1).max(9999))
    .max(16)
    .optional(),
  providerTextPresent: z.boolean().optional(),
  malformedWarningEvidencePresent: z.boolean().optional(),
  legNumber: z.number().int().min(1).max(1000).optional(),
  lineNumber: z.number().int().min(1).max(100000).optional(),
  // Never accept arbitrary reason/message strings from a request or response.
  reason: z
    .string()
    .transform(code => routeDiagnostic({ code }).code)
    .optional(),
});
let nextAttempt = 0;
const history: Record<string, unknown>[] = [];
let revision = 0;
const listeners = new Set<() => void>();
function notifyHistory() {
  revision++;
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A diagnostic viewer must never affect routing or other subscribers.
    }
  });
}
export function subscribeRouteDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function routeDiagnosticRevision() {
  return revision;
}
export function clearRouteDiagnostics() {
  history.length = 0;
  notifyHistory();
}
/** Schema projection is the ONLY logging boundary. No payload, URL, message or identity. */
export function emitRouteDiagnostic(input: unknown) {
  try {
    const checked = schema.safeParse(input);
    if (!checked.success) return;
    const event = {
      event: 'SEMITRAX_ROUTE_DIAG',
      version: 1,
      provider: 'Trimble',
      units: 'FT_LB',
      expectedOverrideRestrict: false,
      actualProviderOverrideRestrict: 'NOT_OBSERVED',
      providerHttpStatus: 'NOT_OBSERVED',
      passengerFallback: 'NO',
      ...checked.data,
      // Local collection time, never a timestamp supplied by a provider payload.
      recordedAt: new Date().toISOString(),
    };
    history.push(event);
    if (history.length > 40) history.shift();
    notifyHistory();
    // RN 0.85 console polyfill forwards info to nativeLoggingHook in release too.
    // No __DEV__ gate; no console.error (which can invoke exception handling).
    console.info('SEMITRAX_ROUTE_DIAG ' + JSON.stringify(event));
  } catch {
    /* Diagnostics must never affect route acceptance or rejection. */
  }
}
export function routeDiagnosticHistory() {
  // A defensive copy prevents UI/share consumers from mutating future output.
  return JSON.parse(JSON.stringify(history)) as Record<string, unknown>[];
}
export function beginRouteDiagnostic(truck: unknown, stopCount: number) {
  const attempt = ++nextAttempt;
  const t =
    truck && typeof truck === 'object'
      ? (truck as Record<string, unknown>)
      : {};
  const present = (keys: string[]) =>
    keys.every(key => typeof t[key] === 'number' && Number.isFinite(t[key]))
      ? 'PRESENT'
      : 'MISSING';
  emitRouteDiagnostic({
    attempt,
    stage: 'REQUEST_PROFILE',
    result: 'PENDING',
    profile: truck && typeof truck === 'object' ? 'PRESENT' : 'MISSING',
    dimensions: present(['heightFt', 'widthFt', 'lengthFt']),
    weight: present(['weightLbs']),
    axles: present(['axleCount']),
    trailers: present(['trailerCount']),
    hazmat:
      t.hazmatEnabled === true
        ? 'ENABLED'
        : t.hazmatEnabled === false
        ? 'DISABLED'
        : 'UNKNOWN',
    stopCount:
      Number.isInteger(stopCount) &&
      stopCount >= 0 &&
      stopCount <= MAX_ROUTE_LOCATIONS
        ? stopCount
        : null,
  });
  return attempt;
}
export function recordRouteFailure(
  attempt: number,
  stage: RouteDiagnosticStage,
  error: unknown,
) {
  try {
    const diagnostic = routeDiagnostic(error);
    const evidence = diagnostic.providerDetail;
    const source =
      stage === 'BACKEND_ERROR'
        ? diagnostic.httpStatus === null
          ? 'UNKNOWN'
          : 'BACKEND_RESPONSE'
        : stage === 'RESPONSE_PARSE'
        ? 'RESPONSE_PARSE'
        : stage === 'REQUEST_CONSTRUCTION'
        ? 'REQUEST_CONSTRUCTION'
        : 'LOCAL_VALIDATION';
    emitRouteDiagnostic({
      attempt,
      stage,
      source,
      result: 'FAIL',
      reason: diagnostic.code,
    });
    if (diagnostic.code === 'TRIMBLE_RESTRICTION_WARNING') {
      emitRouteDiagnostic({
        attempt,
        stage: 'WARNING_ORIGIN',
        result: 'WARNING_OBSERVED',
        // Only backend-supplied allowlisted evidence locates the originating report row.
        source:
          stage === 'BACKEND_ERROR' && evidence
            ? 'PROVIDER_RESTRICTION'
            : 'UNKNOWN',
        reason: diagnostic.code,
        warningEvidence: evidence ? 'PRESENT' : 'ABSENT_OR_INVALID',
        ...(evidence
          ? {
              providerWarningTypes: evidence.providerWarningTypes,
              providerTextPresent: evidence.providerTextPresent,
              malformedWarningEvidencePresent:
                evidence.malformedWarningEvidencePresent,
              legNumber: evidence.legNumber,
              lineNumber: evidence.lineNumber,
            }
          : {}),
      });
    }
    emitRouteDiagnostic({
      attempt,
      stage: 'DECISION',
      source,
      result: 'REJECTED',
      reason: diagnostic.code,
    });
  } catch {
    /* Never replace the original error with a diagnostic failure. */
  }
}
