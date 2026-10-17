import { trimbleRoutingHealth, ROUTING_HEALTH_MAX_AGE_MS } from '../modules/analytics/providerHealth.js';
const optionalPreferences = ['avoidHighways', 'avoidResidential', 'avoidDirtRoads'] as const;
export function optionalPreferenceWarnings(truck: Partial<Record<typeof optionalPreferences[number], boolean>>) {
  return optionalPreferences.filter(preference => truck[preference]).map(preference => ({
    code: 'OPTIONAL_PREFERENCE_UNSUPPORTED' as const, preference, requested: true as const,
    supported: false as const, guaranteed: false as const,
    message: preference + ' cannot be guaranteed by Trimble Route Reports; mandatory truck restrictions remain enforced.',
  }));
}
type HealthRows = Parameters<typeof trimbleRoutingHealth>[1];
let observation: {at: number; code: string | null} | undefined;
/** Only an actual completed provider attempt records runtime evidence. Never configuration presence. */
export function recordRoutingOutcome(code: string | null, at = Date.now()) { observation = {at, code}; }
export function routingHealth(configured: boolean, rows: HealthRows, now = new Date()) {
  const stored = trimbleRoutingHealth(configured, rows, now);
  if (!configured || !observation || observation.at > now.getTime() || now.getTime() - observation.at >= ROUTING_HEALTH_MAX_AGE_MS) return stored;
  const validUntil = new Date(observation.at + ROUTING_HEALTH_MAX_AGE_MS).toISOString();
  return {...stored, status: observation.code ? 'UNAVAILABLE' as const : 'OPERATIONAL' as const,
    reason: observation.code ? 'The latest local Trimble provider attempt failed.' : 'A recent actual Trimble truck route passed response validation.', validUntil};
}
export function routingCapabilities(configured: boolean, rows: HealthRows, now = new Date()) {
  const health = routingHealth(configured, rows, now);
  const recentCode = observation && observation.at <= now.getTime() && now.getTime()-observation.at < ROUTING_HEALTH_MAX_AGE_MS ? observation.code : null;
  const configurationError = !configured || ['TRIMBLE_API_KEY_MISSING','TRIMBLE_CONFIGURATION_INVALID','TRIMBLE_AUTHORIZATION_FAILED'].includes(recentCode ?? '');
  return {
    contractVersion: 'rn-p0-v1',
    truckRouting: {provider:'Trimble', ...health,
      state: configurationError ? 'PROVIDER_MISCONFIGURED' : health.status === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : health.status === 'OPERATIONAL' ? 'PLANNING_AVAILABLE' : 'PLANNING_UNVERIFIED',
      requestAllowed: configured, verifiedProfileRequired:true,
      optionalPreferences: optionalPreferences.map(preference => ({preference,supported:false,guaranteed:false})),
    },
    turnByTurn: {available:false, state:'UNAVAILABLE', reasonCode:'NATIVE_GUIDANCE_NOT_ACCEPTED', licenseStatus:'UNVERIFIED'},
    places: {available:false, reasonCode:'POI_PROVIDER_NOT_CONFIGURED'},
    trips: {available:true, progressSource:'DRIVER_REPORTED', navigationVerified:false},
    documents: {metadataAvailable:true, uploadAvailable:false},
  };
}
