import { Alert } from '../components/ThemedAlert';
import React, { useEffect, useRef, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { Services } from '../app/services';
import { Page, Heading, Copy, Button, ErrorText } from '../components/ui';
import {
  offlineBounds,
  OFFLINE_DISPLAY_NOTICE,
} from '../features/offline/offlinePolicy';
type PackRow = { name: string; percentage: number; bytes: number };
export function OfflineMapsScreen({ services }: { services: Services }) {
  const [rows, setRows] = useState<PackRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [connection, setConnection] = useState('Network availability unknown');
  const alive = useRef(true),
    names = useRef(new Set<string>()),
    lock = useRef(false);
  async function refresh() {
    const packs = await Mapbox.offlineManager.getPacks();
    const data = await Promise.all(
      packs
        .filter(p => String(p.name).startsWith('semitrax-display-'))
        .map(async p => {
          const s = await p.status();
          return {
            name: String(p.name),
            percentage: s.percentage,
            bytes: s.completedResourceSize,
          };
        }),
    );
    if (alive.current) setRows(data);
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => {
      if (alive.current)
        setError('Offline storage unavailable on this runtime.');
    });
    const registered = names.current;
    return () => {
      alive.current = false;
      registered.forEach(name => Mapbox.offlineManager.unsubscribe(name));
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (alive.current) await refresh();
    } catch {
      if (alive.current)
        setError(
          'Offline map operation failed. Check network, storage and Mapbox display configuration.',
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function download() {
    let bounds: [number[], number[]];
    try {
      bounds = offlineBounds(services.location.getFreshFix());
    } catch {
      setError('A fresh precise GPS fix is required for this download.');
      return;
    }
    Alert.alert(
      'Download display map?',
      'Download a 10 km wide area around current GPS, streets style, zoom 8–14. Uses data and device storage; final size depends on tiles. No offline truck routing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => {
            void run(async () => {
              if (!services.environment.mapboxToken)
                throw new Error('Map display unavailable');
              await Mapbox.setAccessToken(services.environment.mapboxToken);
              if (!alive.current) return;
              const name = 'semitrax-display-' + Date.now();
              names.current.add(name);
              await Mapbox.offlineManager.createPack(
                {
                  name,
                  styleURL: Mapbox.StyleURL.Street,
                  bounds,
                  minZoom: 8,
                  maxZoom: 14,
                },
                (_pack, status) => {
                  if (alive.current)
                    setRows(old => [
                      ...old.filter(p => p.name !== name),
                      {
                        name,
                        percentage: status.percentage,
                        bytes: status.completedResourceSize,
                      },
                    ]);
                },
                () => {
                  if (alive.current)
                    setError(
                      'Download interrupted. Check connectivity and storage; refresh to inspect saved data.',
                    );
                },
              );
            });
          },
        },
      ],
    );
  }
  return (
    <Page>
      <Heading>Offline display maps</Heading>
      <Copy>{OFFLINE_DISPLAY_NOTICE}</Copy>
      <Copy>
        Downloaded regions use Streets style. Select day mode and turn satellite
        off to match. Coverage is limited to the saved area and zoom levels.
      </Copy>
      <Copy>{connection}</Copy>
      <Button
        title="Check API connectivity"
        disabled={busy}
        onPress={() => {
          void run(async () => {
            try {
              await services.api.request('GET', '/health');
              if (alive.current)
                setConnection(
                  'SemiTraX API reachable; Mapbox connectivity is separate.',
                );
            } catch {
              if (alive.current)
                setConnection(
                  'SemiTraX API unreachable; offline routing remains unavailable.',
                );
            }
          });
        }}
      />
      <Button
        title="Download current GPS area"
        disabled={busy || !services.environment.mapboxToken}
        onPress={download}
      />
      <Button
        title="Refresh saved regions"
        disabled={busy}
        onPress={() => {
          void run(refresh);
        }}
      />
      <ErrorText message={error} />
      {!rows.length && <Copy>No saved display regions returned.</Copy>}
      {rows.map(row => (
        <React.Fragment key={row.name}>
          <Heading>{row.name}</Heading>
          <Copy>
            {Number.isFinite(row.percentage)
              ? row.percentage.toFixed(0)
              : 'Unknown'}
            % · {(row.bytes / 1048576).toFixed(1)} MB downloaded
          </Copy>
          <Button
            title={'Delete ' + row.name}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Delete display region?',
                'This removes only this saved Mapbox display pack.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      void run(async () => {
                        await Mapbox.offlineManager.deletePack(row.name);
                        Mapbox.offlineManager.unsubscribe(row.name);
                        names.current.delete(row.name);
                      });
                    },
                  },
                ],
              )
            }
          />
        </React.Fragment>
      ))}
    </Page>
  );
}
