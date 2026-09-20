import type { LocationFix } from '../../services/location/LocationService';
export type AppearanceMode = 'system' | 'day' | 'night';
/** NOAA solar position approximation, UTC: https://gml.noaa.gov/grad/solcalc/solareqns.PDF */
export function solarElevation(
  now: number,
  latitude: number,
  longitude: number,
) {
  const d = new Date(now),
    year = d.getUTCFullYear();
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const day =
    (Date.UTC(year, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(year, 0, 1)) /
      86400000 +
    1;
  const hour =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / days) * (day - 1 + (hour - 12) / 24),
    c = Math.cos,
    s = Math.sin;
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * c(g) -
      0.032077 * s(g) -
      0.014615 * c(2 * g) -
      0.040849 * s(2 * g));
  const dec =
    0.006918 -
    0.399912 * c(g) +
    0.070257 * s(g) -
    0.006758 * c(2 * g) +
    0.000907 * s(2 * g) -
    0.002697 * c(3 * g) +
    0.00148 * s(3 * g);
  const angle = (((hour * 60 + eq + 4 * longitude) / 4 - 180) * Math.PI) / 180,
    lat = (latitude * Math.PI) / 180;
  return (
    (Math.asin(
      Math.max(-1, Math.min(1, s(lat) * s(dec) + c(lat) * c(dec) * c(angle))),
    ) *
      180) /
    Math.PI
  );
}
export function resolveAppearance(
  mode: AppearanceMode,
  fix: LocationFix | null,
  now = Date.now(),
  previous?: 'day' | 'night',
): AppearanceMode {
  if (mode !== 'system') return mode;
  if (
    !fix ||
    ![fix.latitude, fix.longitude, fix.accuracy, fix.timestamp, now].every(
      Number.isFinite,
    ) ||
    Math.abs(fix.latitude) > 65 ||
    Math.abs(fix.longitude) > 180 ||
    fix.accuracy < 0 ||
    fix.accuracy > 1000 ||
    now - fix.timestamp > 300000 ||
    fix.timestamp > now + 5000
  )
    return 'system';
  const altitude = solarElevation(now, fix.latitude, fix.longitude);
  // Half-degree transition band avoids repeated switching from small position changes.
  if (previous && altitude > -1.083 && altitude < -0.583) return previous;
  return altitude >= -0.833 ? 'day' : 'night';
}

export type SolarAppearanceSchedule = {
  createdAt: number;
  expiresAt: number;
  changes: Array<{ at: number; mode: 'day' | 'night' }>;
};
/** Appearance-only daylight forecast from a freshly validated fix. Contains no location
 * and never supplies a stale fix to routing. Prevents a GPS timeout selecting phone Night. */
export function createSolarAppearanceSchedule(
  fix: LocationFix | null,
  now: number,
): SolarAppearanceSchedule | null {
  const first = resolveAppearance('system', fix, now);
  if (first === 'system' || !fix) return null;
  const changes: Array<{ at: number; mode: 'day' | 'night' }> = [
    { at: now, mode: first },
  ];
  let previous = first;
  for (let at = now + 60000; at <= now + 86400000; at += 60000) {
    const altitude = solarElevation(at, fix.latitude, fix.longitude);
    const next =
      altitude > -1.083 && altitude < -0.583
        ? previous
        : altitude >= -0.833
        ? 'day'
        : 'night';
    if (next !== previous) {
      changes.push({ at, mode: next });
      previous = next;
    }
  }
  return { createdAt: now, expiresAt: now + 86400000, changes };
}
export function scheduledAppearance(
  schedule: SolarAppearanceSchedule | null,
  now: number,
): 'day' | 'night' | null {
  if (!schedule || now < schedule.createdAt || now >= schedule.expiresAt)
    return null;
  return (
    [...schedule.changes].reverse().find(change => change.at <= now)?.mode ??
    null
  );
}
