import React, { useEffect, useRef, useState } from 'react';
import { DriverCopy, DriverTitle } from '../../components/DriverUI';
import { CorridorRecords } from '../dot511/CorridorRecords';
import { stopDistanceMeters } from '../../models/stopCoverage';
import type { TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../../services/location/LocationService';
import type { Poi, PoiService } from './PoiService';

/** Nearby records retain their own identities; proximity is not a provider-ID match. */
export function PlaceLiveDetails({
  poi,
  service,
  route,
  fix,
}: {
  poi: Poi;
  service: PoiService;
  route: TruckRoute | null;
  fix: LocationFix | null;
}) {
  const latestFix = useRef(fix);
  latestFix.current = fix;
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let live = true;
    const queryFix = latestFix.current;
    setItems([]);
    if (!route || !queryFix) {
      setStatus(
        'Plan a route to check nearby parking, weigh-station reports and diesel prices.',
      );
      return;
    }
    setStatus('Checking available reports…');
    void Promise.allSettled(
      (['parking', 'weigh-stations', 'fuel'] as const).map(kind =>
        service.corridor(kind, route, 0, queryFix),
      ),
    ).then(results => {
      if (!live) return;
      const records = results
        .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
        .filter(
          item =>
            typeof item.latitude === 'number' &&
            Number.isFinite(item.latitude) &&
            typeof item.longitude === 'number' &&
            Number.isFinite(item.longitude) &&
            stopDistanceMeters(
              { lat: poi.latitude, lng: poi.longitude },
              { lat: item.latitude, lng: item.longitude },
            ) <= 200,
        );
      setItems(records);
      setStatus(
        records.length
          ? 'Reports within 200 m — check each location name. These may describe a neighboring facility.'
          : results.some(result => result.status === 'rejected')
          ? 'Some report services could not be reached. Current conditions are unknown.'
          : 'No current report records returned near this place.',
      );
    });
    return () => {
      live = false;
    };
  }, [poi.id, poi.latitude, poi.longitude, service, route]);
  return (
    <>
      <DriverTitle small>Parking, scales & fuel</DriverTitle>
      <DriverCopy>{status}</DriverCopy>
      <CorridorRecords items={items} />
      <DriverCopy>Ratings: no connected review provider.</DriverCopy>
    </>
  );
}
