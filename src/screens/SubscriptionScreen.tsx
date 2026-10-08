import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import type { Services } from '../app/services';
import { DriverButton, DriverCard, DriverCopy, DriverPage, DriverTitle } from '../components/DriverUI';
import { errorMessage } from '../components/ui';
import { useStore } from '../hooks/useStore';

type AccessView =
  | { phase: 'loading' }
  | { phase: 'ready'; accessState: string | null }
  | { phase: 'disabled' }
  | { phase: 'error'; message: string };

type RequestIsActive = () => boolean;

export function SubscriptionScreen({ services }: { services: Services }) {
  const auth = useStore(services.auth);
  const accountId = auth.user?.id ?? null;
  const [access, setAccess] = useState<AccessView>({ phase: 'loading' });
  const requestGeneration = useRef(0);

  const refresh = useCallback(async (isActive: RequestIsActive = () => true) => {
    const generation = ++requestGeneration.current;
    setAccess({ phase: 'loading' });
    try {
      const reply = await services.api.request<{ accessState?: unknown }>(
        'GET',
        '/entitlements',
      );
      if (
        !isActive() ||
        generation !== requestGeneration.current ||
        services.auth.getSnapshot().user?.id !== accountId
      ) {
        return;
      }
      const state =
        typeof reply?.accessState === 'string' && reply.accessState.trim()
          ? reply.accessState.trim()
          : null;
      setAccess({ phase: 'ready', accessState: state });
    } catch (error) {
      if (
        !isActive() ||
        generation !== requestGeneration.current ||
        services.auth.getSnapshot().user?.id !== accountId
      ) {
        return;
      }
      if ((error as { code?: string }).code === 'BILLING_DISABLED') {
        setAccess({ phase: 'disabled' });
      } else {
        setAccess({ phase: 'error', message: errorMessage(error) });
      }
    }
  }, [accountId, services]);

  useEffect(() => {
    let active = true;
    void refresh(() => active);
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <DriverPage>
      <DriverTitle>Subscription & access</DriverTitle>
      <DriverCopy>
        {'Read-only account access status. This screen does not purchase, renew, cancel or change a subscription.'}
      </DriverCopy>

      <DriverCard>
        <DriverTitle small>Current account</DriverTitle>
        <DriverCopy>{`Plan: ${auth.user?.plan || 'Unavailable'}`}</DriverCopy>
        <DriverCopy>{`Account: ${auth.user?.email || 'Unavailable'}`}</DriverCopy>
      </DriverCard>

      <DriverCard>
        <DriverTitle small>Access status</DriverTitle>
        {access.phase === 'loading' ? (
          <DriverCopy>Checking account access…</DriverCopy>
        ) : access.phase === 'disabled' ? (
          <DriverCopy>Billing is disabled in this build.</DriverCopy>
        ) : access.phase === 'error' ? (
          <Text accessibilityRole="alert">{access.message}</Text>
        ) : access.accessState ? (
          <DriverCopy>{`Access state: ${access.accessState}`}</DriverCopy>
        ) : (
          <DriverCopy>The server did not provide an access state.</DriverCopy>
        )}
      </DriverCard>

      <DriverButton
        title="Refresh access status"
        secondary
        disabled={access.phase === 'loading'}
        onPress={() => {
          void refresh();
        }}
      />

      <DriverCard>
        <DriverTitle small>Billing safety</DriverTitle>
        <DriverCopy>
          {'No checkout, purchase, renewal, cancellation or billing change is performed from this screen. Pricing is not shown unless a verified billing catalog is available.'}
        </DriverCopy>
      </DriverCard>
    </DriverPage>
  );
}
