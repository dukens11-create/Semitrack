import { Alert } from 'react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Services } from '../../app/services';
import type { TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../../services/location/LocationService';
import { DriverButton, DriverCopy, DriverTitle } from '../../components/DriverUI';
import { CorridorRecords } from '../dot511/CorridorRecords';
import { RouteProgressMonitor } from './RouteProgressMonitor';
import { WarningManager } from './WarningManager';
export function RouteAdvisories({
  services,
  route,
  fix,
  expanded,
}: {
  services: Services;
  route: TruckRoute;
  fix: LocationFix | null;
  expanded: boolean;
}) {
  const monitor = useMemo(
    () => new RouteProgressMonitor(route.routeGeometry),
    [route],
  );
  const [manager] = useState(() => new WarningManager());
  const [, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('Road warnings not loaded.'),
    [intel, setIntel] = useState<Record<string, unknown>[]>([]);
  const request = useRef<AbortController | null>(null);
  const projection = useMemo(() => monitor.update(fix), [monitor, fix]);
  useEffect(() => {
    manager.reset();
    setIntel([]);
    setNotice('Road warnings not loaded.');
  }, [manager, route]);
  useEffect(() => {
    const timer = setInterval(() => setRevision(v => v + 1), 5000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [manager]);
  const warnings =
    projection.offset === undefined ||
    !fix ||
    Date.now() - fix.timestamp > 15000
      ? []
      : manager.visible(projection.offset);
  async function load() {
    if (busy) return;
    const current = services.location.getFreshFix();
    const start = monitor.update(current);
    if (!current || start.offset === undefined) {
      setNotice('Fresh GPS matched unambiguously to this route is required.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const kinds = [
        'restrictions',
        'road-events',
        'cameras',
        'parking',
        'fuel',
        'weigh-stations',
      ] as const;
      const results = await Promise.allSettled(
        kinds.map(kind =>
          services.poi.corridor(
            kind,
            route,
            start.offset,
            current,
            controller.signal,
          ),
        ),
      );
      if (
        controller.signal.aborted ||
        services.routes.getSnapshot().route !== route
      )
        return;
      const records = Object.fromEntries(
        kinds.map((kind, index) => {
          const result = results[index];
          return [
            kind,
            result?.status === 'fulfilled' ? result.value : [],
          ];
        }),
      ) as Record<(typeof kinds)[number], Record<string, unknown>[]>;
      manager.load(
        [
          ...records.restrictions.map(item => ({
            ...item,
            severity:
              typeof item.severity === 'string' ? item.severity : 'HIGH',
          })),
          ...records['road-events'],
        ],
        start.offset,
      );
      const intelRecords: Record<string, unknown>[] = [
        ...records.cameras.map(item => ({ ...item, intelKind: 'Camera' })),
        ...records.parking.map(item => ({ ...item, intelKind: 'Parking' })),
        ...records.fuel.map(item => ({ ...item, intelKind: 'Fuel' })),
        ...records['weigh-stations'].map(item => ({
          ...item,
          intelKind: 'Weigh station',
        })),
      ];
      setIntel(
        intelRecords.filter(item => {
          const ahead = item.routeDistanceAheadMeters;
          return (
            typeof ahead === 'number' &&
            Number.isFinite(ahead) &&
            ahead >= 0
          );
        }),
      );
      const available = results.filter(
        result => result.status === 'fulfilled',
      ).length;
      setNotice(
        `Loaded ${available} of ${kinds.length} route-data categories. Provider advisories expire locally after five minutes. Missing coverage does not mean roads are clear.`,
      );
      setRevision(v => v + 1);
    } catch {
      if (!controller.signal.aborted)
        setNotice('Road warning data unavailable.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      {(expanded || projection.status === 'off-route') && (
        <DriverCopy>
          {projection.status === 'off-route'
            ? 'GPS repeatedly away from planned route. Follow road signs; commercial rerouting requires licensed guidance.'
            : notice}
        </DriverCopy>
      )}
      {expanded && (
        <DriverButton
          title="Refresh road warnings"
          secondary
          disabled={busy}
          onPress={() => {
            void load();
          }}
        />
      )}
      {warnings.map(w => (
        <React.Fragment key={w.id}>
          <DriverCopy>
            {w.severity} · {w.stage} · {w.title} ·{' '}
            {projection.offset !== undefined
              ? Math.max(0, (w.offset - projection.offset) / 1609.344).toFixed(
                  1,
                ) + ' mi ahead · '
              : ''}
            Source: {w.source}
          </DriverCopy>
          <DriverButton
            title={
              (w.severity === 'HIGH' ? 'Acknowledge ' : 'Dismiss ') + w.title
            }
            secondary
            onPress={() => {
              if (w.severity === 'HIGH') {
                Alert.alert(
                  'Acknowledge warning?',
                  'This hides this alert only. Truck restrictions and road instructions still apply.',
                  [
                    { text: 'Keep warning', style: 'cancel' },
                    {
                      text: 'Acknowledge',
                      onPress: () => {
                        manager.dismiss(w.id, true);
                        setRevision(v => v + 1);
                      },
                    },
                  ],
                );
              } else {
                manager.dismiss(w.id);
                setRevision(v => v + 1);
              }
            }}
          />
        </React.Fragment>
      ))}
      {expanded && intel.length > 0 && (
        <>
          <DriverTitle small>Route intel ahead</DriverTitle>
          <DriverCopy>
            Cameras, parking, fuel and weigh-station records below are provider
            observations only. Missing or stale status remains unknown.
          </DriverCopy>
          <CorridorRecords items={intel} />
        </>
      )}
    </>
  );
}
