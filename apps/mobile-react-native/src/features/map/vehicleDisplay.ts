import { useEffect, useRef, useState } from 'react';
import type { LocationFix } from '../../services/location/LocationService';
/** Display interpolation only between received GPS samples; never extrapolates or feeds routing. */
export function interpolateVehicleFix(
  from: LocationFix,
  to: LocationFix,
  fraction: number,
): LocationFix {
  const t = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 1));
  const turn =
    from.heading !== null && to.heading !== null
      ? ((to.heading - from.heading + 540) % 360) - 180
      : null;
  return {
    ...to,
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
    heading:
      turn === null
        ? to.heading
        : (((from.heading! + turn * t) % 360) + 360) % 360,
  };
}
export function useVehicleDisplay(fix: LocationFix | null): LocationFix | null {
  const [display, setDisplay] = useState(fix);
  const latest = useRef(fix);
  useEffect(() => {
    const from = latest.current;
    latest.current = fix;
    if (
      !fix ||
      !from ||
      fix.timestamp <= from.timestamp ||
      fix.timestamp - from.timestamp > 15000
    ) {
      setDisplay(fix);
      return;
    }
    let frame: number;
    const began = Date.now();
    const duration = Math.min(300, fix.timestamp - from.timestamp);
    const tick = () => {
      const t = Math.min(1, (Date.now() - began) / duration);
      setDisplay(interpolateVehicleFix(from, fix, t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fix]);
  return fix ? display : null;
}
