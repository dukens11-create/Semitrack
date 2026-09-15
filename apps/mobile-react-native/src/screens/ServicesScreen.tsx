import React, { useState } from 'react';
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
export function ServicesScreen({ services }: { services: Services }) {
  const route = useStore(services.routes).route;
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function load(
    kind:
      | 'restrictions'
      | 'road-events'
      | 'cameras'
      | 'parking'
      | 'fuel'
      | 'weigh-stations',
  ) {
    if (!route) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setItems([]);
    try {
      const data = await services.poi.corridor(kind, route);
      setItems(data);
      setStatus(
        data.length
          ? 'Provider results for the planned route. Confirm timestamps and source.'
          : 'No provider records returned for this route. Availability is unknown.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
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
      <Heading>Coming in a later version</Heading>
      <Copy>
        CAT scales, repair shops, restaurants, hotels and camera viewing are not
        yet available. Live parking availability, weigh-station status and fuel
        prices depend on local data coverage. Missing information means unknown.
      </Copy>
      <Copy>
        Trip history, document storage, fleet and dispatch, ELD connections and
        subscriptions are not yet available in this version.
      </Copy>
      <Copy>
        Offline map downloads and offline commercial truck navigation are
        unavailable.
      </Copy>
    </Page>
  );
}
