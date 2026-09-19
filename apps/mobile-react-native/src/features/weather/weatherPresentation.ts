import type { LocationFix } from '../../services/location/LocationService';
import type { Settings } from '../settings/SettingsService';
export function temperatureUnit(
  settings: Settings | null | undefined,
): 'F' | 'C' {
  return settings?.settingsJson?.rnTemperatureUnit === 'C' ? 'C' : 'F';
}
export function temperatureText(f: number, unit: 'F' | 'C') {
  return Math.round(unit === 'C' ? ((f - 32) * 5) / 9 : f) + '°' + unit;
}
export function weatherPresentation(
  raw: Record<string, unknown> | undefined,
  fix: LocationFix | null,
  now = Date.now(),
) {
  const unavailable = { status: 'UNAVAILABLE' as const };
  if (
    !raw ||
    raw.status !== 'AREA_OBSERVATION' ||
    typeof raw.tempF !== 'number' ||
    !Number.isFinite(raw.tempF) ||
    typeof raw.provider !== 'string' ||
    !raw.provider.trim() ||
    typeof raw.condition !== 'string'
  )
    return unavailable;
  const point = raw.providerPoint as { lat?: number; lng?: number } | undefined;
  if (
    !fix ||
    !point ||
    typeof point.lat !== 'number' ||
    typeof point.lng !== 'number' ||
    ![fix.latitude, fix.longitude, point.lat, point.lng, fix.timestamp].every(
      Number.isFinite,
    ) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    return unavailable;
  const rad = Math.PI / 180,
    dl = (fix.latitude - point.lat) * rad,
    dn = (fix.longitude - point.lng) * rad;
  const a =
    Math.sin(dl / 2) ** 2 +
    Math.cos(fix.latitude * rad) *
      Math.cos(point.lat * rad) *
      Math.sin(dn / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const observed =
    typeof raw.observedAt === 'string' ? Date.parse(raw.observedAt) : NaN;
  if (!Number.isFinite(observed) || observed > now + 300000) return unavailable;
  if (
    now - observed > 7200000 ||
    now - fix.timestamp > 300000 ||
    fix.timestamp > now + 5000 ||
    distance > 25000
  )
    return { status: 'STALE' as const };
  return {
    status: 'CURRENT' as const,
    tempF: raw.tempF,
    condition: raw.condition.slice(0, 80),
    provider: raw.provider.slice(0, 80),
    observedAt: raw.observedAt,
  };
}
/** Reserved for a provider's explicit correlated alerts, never inferred from temperature or rain. */
export function activeWeatherAlerts(items: unknown, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (
      x,
    ): x is {
      title: string;
      severity: string;
      provider: string;
      expiresAt: string;
      areaVerified: true;
    } =>
      !!x &&
      typeof x === 'object' &&
      typeof x.title === 'string' &&
      x.title.length > 0 &&
      x.title.length <= 200 &&
      ['SEVERE', 'EXTREME'].includes(x.severity) &&
      typeof x.provider === 'string' &&
      x.provider.length > 0 &&
      x.areaVerified === true &&
      typeof x.expiresAt === 'string' &&
      Date.parse(x.expiresAt) > now,
  );
}
