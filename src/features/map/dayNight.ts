const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (value: number) => (value * 180) / Math.PI;

/**
 * Returns true for astronomical night, false for daylight, or null for invalid input.
 * Uses the NOAA solar-position approximation and civil sunrise/sunset altitude.
 */
export function isNightAtLocation(
  date: Date,
  latitude: number,
  longitude: number,
): boolean | null {
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;

  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const dayOfYear = Math.floor((current - start) / 86400000);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const gamma =
    (2 * Math.PI * (dayOfYear - 1 + (utcHours - 12) / 24)) / 365;
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const lat = radians(latitude);
  const zenith = radians(90.833);
  const denominator = Math.cos(lat) * Math.cos(declination);
  if (Math.abs(denominator) < 1e-12) return null;
  const cosineHourAngle =
    (Math.cos(zenith) - Math.sin(lat) * Math.sin(declination)) / denominator;

  if (cosineHourAngle > 1) return true; // polar night
  if (cosineHourAngle < -1) return false; // polar day

  const hourAngleDegrees = degrees(Math.acos(cosineHourAngle));
  const solarNoonUtcMinutes = 720 - 4 * longitude - equationOfTime;
  let sunrise = solarNoonUtcMinutes - 4 * hourAngleDegrees;
  let sunset = solarNoonUtcMinutes + 4 * hourAngleDegrees;
  const normalize = (minutes: number) => ((minutes % 1440) + 1440) % 1440;
  sunrise = normalize(sunrise);
  sunset = normalize(sunset);
  const nowMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60;
  const daylight =
    sunrise <= sunset
      ? nowMinutes >= sunrise && nowMinutes <= sunset
      : nowMinutes >= sunrise || nowMinutes <= sunset;
  return !daylight;
}
