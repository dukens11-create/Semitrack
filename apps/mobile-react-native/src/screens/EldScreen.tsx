import { Alert } from '../components/ThemedAlert';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { Services } from '../app/services';
import {
  Page,
  Heading,
  Copy,
  Button,
  ErrorText,
  errorMessage,
} from '../components/ui';
import {
  EldService,
  eldProviders,
  type EldConnection,
  type EldProvider,
} from '../features/eld/EldService';
export function EldScreen({ services }: { services: Services }) {
  const eld = useMemo(() => new EldService(services.api), [services]);
  const [items, setItems] = useState<EldConnection[]>([]),
    [hos, setHos] = useState('UNKNOWN'),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    lock = useRef(false);
  async function refresh(signal?: AbortSignal) {
    const [connections, current] = await Promise.all([
      eld.connections(signal),
      eld.hos(signal),
    ]);
    if (alive.current && !signal?.aborted) {
      setItems(connections);
      setHos('UNKNOWN · ' + current.reason);
    }
  }
  useEffect(() => {
    alive.current = true;
    const c = new AbortController();
    void refresh(c.signal).catch(() => {
      if (!c.signal.aborted)
        setError('ELD status unavailable. Retry when connected.');
    });
    return () => {
      alive.current = false;
      c.abort();
    };
  }, [eld]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (alive.current) await refresh();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function disconnect(provider: EldProvider) {
    Alert.alert(
      'Disconnect ' + provider + '?',
      'SemiTraX will stop reading this connection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void run(() => eld.disconnect(provider));
          },
        },
      ],
    );
  }
  return (
    <Page>
      <Heading>ELD connections</Heading>
      <Copy>
        Read-only provider integration. SemiTraX is not a certified ELD and does
        not edit duty logs. Provider authorization and signed-in driver mapping
        are separate requirements.
      </Copy>
      <Button
        title="Refresh connections"
        disabled={busy}
        onPress={() => {
          void run(() => refresh());
        }}
      />
      <ErrorText message={error} />
      <Copy>My HOS: {hos}. Remaining drive time is not assumed.</Copy>
      {eldProviders.map(provider => {
        const c = items.find(i => i.provider === provider);
        return (
          <React.Fragment key={provider}>
            <Heading>{provider}</Heading>
            <Copy>{c?.status ?? 'Connection status unknown'}</Copy>
            <Copy>Last sync: {c?.lastSyncedAt ?? 'Not available'}</Copy>
            {c?.lastErrorCode && <Copy>Provider error: {c.lastErrorCode}</Copy>}
            <Button
              title={'Connect ' + provider}
              disabled={busy}
              onPress={() => {
                void run(async () => {
                  const url = await eld.connect(provider);
                  if (alive.current) await Linking.openURL(url);
                });
              }}
            />
            <Button
              title={'Sync ' + provider}
              disabled={busy || c?.status !== 'CONNECTED'}
              onPress={() => {
                void run(() => eld.sync(provider));
              }}
            />
            <Button
              title={'Disconnect ' + provider}
              disabled={busy || !c || c.status === 'DISCONNECTED'}
              onPress={() => disconnect(provider)}
            />
          </React.Fragment>
        );
      })}
      <Copy>
        After provider authorization, return here and refresh. A successful
        connection does not prove HOS identity or available driving hours.
      </Copy>
    </Page>
  );
}
