import { Alert } from '../components/ThemedAlert';
import React, { useEffect, useRef, useState } from 'react';
import type { Services } from '../app/services';
import {
  Page,
  Heading,
  Copy,
  Button,
  ErrorText,
  errorMessage,
} from '../components/ui';
import { useStore } from '../hooks/useStore';
import { CorridorRecords } from '../features/dot511/CorridorRecords';
export function ServicesScreen({
  services,
  onEld,
  onOffline,
}: {
  services: Services;
  onEld?: () => void;
  onOffline?: () => void;
}) {
  const [kindLoaded, setKindLoaded] = useState('');
  const route = useStore(services.routes).route;
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const revision = generation;
    const requests = controller;
    ++revision.current;
    requests.current?.abort();
    setItems([]);
    setStatus('');
    setBusy(false);
    return () => {
      ++revision.current;
      requests.current?.abort();
    };
  }, [route]);
  async function load(
    kind:
      | 'restrictions'
      | 'road-events'
      | 'cameras'
      | 'parking'
      | 'fuel'
      | 'weigh-stations'
      | 'weather',
  ) {
    if (!route) {
      return;
    }
    if (controller.current) controller.current.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++generation.current;
    setBusy(true);
    setError(undefined);
    setItems([]);
    try {
      const fix = services.location.getFreshFix();
      if (!fix) {
        setStatus(
          'A fresh precise GPS location is required for route-relative information.',
        );
        return;
      }
      const data =
        kind === 'weather'
          ? await services.poi.routeWeather(route, fix, request.signal)
          : await services.poi.corridor(kind, route, 0, fix, request.signal);
      if (
        current !== generation.current ||
        services.routes.getSnapshot().route !== route
      )
        return;
      setKindLoaded(kind);
      setItems(data);
      setStatus(
        data.length
          ? 'Provider results for the planned route. Confirm timestamps and source.'
          : 'No provider records returned for this route. Availability is unknown.',
      );
    } catch (e) {
      if (current === generation.current) setError(errorMessage(e));
    } finally {
      if (current === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <Page>
      <Heading>Road and truck services</Heading>
      <Copy>
        Plan a route to inspect road conditions and services ahead. These
        records supplement the truck route and do not authorize travel through a
        restriction.
      </Copy>
      {(
        [
          'restrictions',
          'road-events',
          'cameras',
          'parking',
          'fuel',
          'weigh-stations',
          'weather',
        ] as const
      ).map(kind => (
        <Button
          key={kind}
          title={kind.replace(/-/g, ' ')}
          disabled={!route || busy}
          onPress={() => {
            void load(kind);
          }}
        />
      ))}
      <ErrorText message={error} />
      <Copy>{status}</Copy>
      <CorridorRecords items={items} />
      {kindLoaded === 'weigh-stations' &&
        items
          .filter(item => typeof item.id === 'string')
          .map(item => (
            <React.Fragment key={String(item.id)}>
              <Copy>
                {String(item.name ?? 'Weigh station')}: missing or stale status
                means UNKNOWN; never permission to bypass inspection.
              </Copy>
              {(['OPEN', 'CLOSED', 'INSPECTION'] as const).map(value => (
                <Button
                  key={value}
                  title={
                    'Report ' + String(item.name ?? 'station') + ' ' + value
                  }
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      'Submit your observation?',
                      'This is a community report, not an official instruction. Report only what you personally observed.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Submit',
                          onPress: () => {
                            const fix = services.location.getFreshFix();
                            if (!fix) {
                              setError(
                                'Fresh GPS required to submit a station observation.',
                              );
                              return;
                            }
                            setBusy(true);
                            void services.poi
                              .report(
                                'WEIGH_STATION_STATUS',
                                String(item.id),
                                value,
                                { lat: fix.latitude, lng: fix.longitude },
                              )
                              .then(() =>
                                setStatus(
                                  'Observation submitted for community validation. Station status has not been assumed.',
                                ),
                              )
                              .catch(e => setError(errorMessage(e)))
                              .finally(() => setBusy(false));
                          },
                        },
                      ],
                    )
                  }
                />
              ))}
            </React.Fragment>
          ))}
      <Button
        title="ELD connections and HOS"
        onPress={() => onEld?.()}
        disabled={!onEld}
      />
      <Button
        title="Offline display maps"
        onPress={() => onOffline?.()}
        disabled={!onOffline}
      />
      <Heading>Coming in a later version</Heading>
      <Copy>
        CAT Scales and truck repair are available through Map place search when
        the provider has coverage. Live parking availability, weigh-station
        status and fuel prices depend on local data coverage. Missing
        information means unknown.
      </Copy>
      <Copy>
        Trips and dispatch review are available in Trips. Documents supports
        metadata only. Private file storage and live ELD/HOS require provider
        setup; billing remains disabled.
      </Copy>
      <Copy>
        Mapbox display packs can be managed under Offline display maps. Offline
        commercial truck navigation remains unavailable.
      </Copy>
    </Page>
  );
}
