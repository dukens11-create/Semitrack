import type { DashboardData } from './types';

type RoutingHealthResponse = Pick<DashboardData['liveOperations'], 'trimbleRouting' | 'hereService'>;

export function routingHealthDisplay(live: RoutingHealthResponse | undefined, unavailable = false, now = Date.now()) {
  // Prefer current Trimble evidence. Legacy hereService is accepted only as an
  // old response shape: its status/configuration cannot establish Trimble health.
  const health = live?.trimbleRouting;
  let status = health?.status;
  if (unavailable || !['OPERATIONAL', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(status ?? '')) status = 'UNAVAILABLE';
  if (status === 'OPERATIONAL') {
    const expires = Date.parse(health?.validUntil ?? '');
    if (!health?.configured || !Number.isFinite(expires) || expires <= now) status = 'DEGRADED';
  }
  return {
    value: status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : status!,
    tone: status === 'OPERATIONAL' ? 'ok' : status === 'DEGRADED' ? 'warn' : status === 'UNAVAILABLE' ? 'danger' : 'muted',
  };
}
