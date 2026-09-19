import { routeDiagnosticHistory } from './routeTelemetry';

const fields: [string, string][] = [
  ['recordedAt', 'Recorded at (UTC)'],
  ['attempt', 'Attempt'],
  ['stage', 'Stage'],
  ['provider', 'Provider'],
  ['source', 'Evidence source'],
  ['result', 'Result'],
  ['profile', 'Truck profile'],
  ['dimensions', 'Dimensions'],
  ['weight', 'Weight'],
  ['axles', 'Axles'],
  ['trailers', 'Trailers'],
  ['hazmat', 'Hazmat'],
  ['units', 'Request units'],
  ['expectedOverrideRestrict', 'Required OverrideRestrict'],
  ['actualProviderOverrideRestrict', 'Observed provider OverrideRestrict'],
  ['stopCount', 'Stop count'],
  ['backendHttpStatus', 'Backend HTTP status'],
  ['responseReceived', 'Backend response received'],
  ['providerHttpStatus', 'Provider HTTP status'],
  ['warningEvidence', 'Warning evidence'],
  ['providerWarningTypes', 'Provider warning types'],
  ['providerTextPresent', 'Provider warning text present'],
  ['legNumber', 'Report leg number'],
  ['lineNumber', 'Report line number'],
  ['reason', 'Reason identifier'],
  ['passengerFallback', 'Passenger fallback'],
];

/** All three UI/export surfaces use the existing schema-projected history only.
 * No raw route, error, provider payload, account or settings data enters here.
 */
export function routeDiagnosticReport() {
  const events = routeDiagnosticHistory().map(event =>
    fields
      .filter(([key]) => event[key] !== undefined)
      .map(([key, label]) => {
        const value = event[key];
        return `${label}: ${
          value === null
            ? 'NOT_OBSERVED'
            : Array.isArray(value)
            ? value.length
              ? value.join(', ')
              : 'NONE_RECORDED'
            : String(value)
        }`;
      })
      .join('\n'),
  );
  return {
    events,
    text: [
      'SEMITRAX_ROUTE_DIAG — Route Diagnostics',
      'Sanitized local events, oldest first. Up to 40 events in this app session.',
      'NOT_OBSERVED means unavailable; required settings are not proof of provider receipt.',
      events.length ? events.join('\n\n') : 'No route diagnostics recorded yet',
    ].join('\n\n'),
  };
}
