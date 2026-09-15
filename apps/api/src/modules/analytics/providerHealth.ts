type ProviderIdentity = { provider: string };

/** Historical rows remain in the database, but retired vendors are not current services. */
export function isCurrentAdminProvider(state: ProviderIdentity): boolean {
  return !/^(here|tomtom)(?:$|[\s_:./-])/i.test(state.provider.trim());
}

type RoutingHealthRecord = ProviderIdentity & {
  dataType: string;
  status: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
};
export type RoutingHealthStatus = 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
// A sync record is evidence, not a live probe. Never retain green indefinitely.
export const ROUTING_HEALTH_MAX_AGE_MS = 5 * 60_000;

export function trimbleRoutingHealth(configured: boolean, states: readonly RoutingHealthRecord[], now = new Date()) {
  const result = (status: RoutingHealthStatus, reason: string, validUntil: string | null = null) =>
    ({ configured, status, reason, validUntil });
  if (!configured) return result('NOT_CONFIGURED', 'Trimble routing credentials are not configured.');
  // DOT/POI sync success, including a Trimble non-routing feed, cannot prove routing health.
  const routing = states.filter(state => state.provider.trim().toLowerCase() === 'trimble' && state.dataType.trim().toUpperCase() === 'ROUTING');
  if (!routing.length) return result('DEGRADED', 'Trimble is configured, but no routing health result is available.');
  if (routing.some(state => ['ERROR', 'DISABLED'].includes(state.status))) {
    return result('UNAVAILABLE', 'The backend reports a failed or disabled Trimble routing service.');
  }
  const nowMs = now.getTime();
  const fresh = routing.every(state => {
    const success = state.lastSuccessAt?.getTime() ?? NaN;
    const attempt = state.lastAttemptAt?.getTime() ?? success;
    return state.status === 'HEALTHY' && !state.lastErrorCode &&
      Number.isFinite(success) && success <= nowMs && nowMs - success < ROUTING_HEALTH_MAX_AGE_MS &&
      Number.isFinite(attempt) && attempt <= success;
  });
  if (!fresh) return result('DEGRADED', 'Trimble routing health is degraded, stale or not yet verified.');
  const expires = Math.min(...routing.map(state => state.lastSuccessAt!.getTime() + ROUTING_HEALTH_MAX_AGE_MS));
  return result('OPERATIONAL', 'Recent successful Trimble routing health is recorded by the backend.', new Date(expires).toISOString());
}
