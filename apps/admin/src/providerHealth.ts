import type { DashboardData } from './types';

export function routingHealthDisplay(health: DashboardData['liveOperations']['trimbleRouting'] | undefined, unavailable = false, now = Date.now()) {
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
