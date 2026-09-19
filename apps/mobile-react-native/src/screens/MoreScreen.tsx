import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Services } from '../app/services';
import { z } from 'zod';
import { errorMessage } from '../components/ui';
import { useStore } from '../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverPage,
  DriverTile,
  DriverTitle,
  useDriverPalette,
  ds,
} from '../components/DriverUI';
import { DriverIcon } from '../components/DriverIcon';
// Category colors affect artwork only; availability and card styling stay separate.
const featureIconColors = {
  day: {
    eld: { foreground: '#0969B6', background: '#E8F3FF' },
    offline: { foreground: '#007680', background: '#E2F7F5' },
    settings: { foreground: '#475569', background: '#EEF2F6' },
    services: { foreground: '#9C5700', background: '#FFF4DB' },
    trucks: { foreground: '#174B7A', background: '#E8F2FC' },
  },
  night: {
    eld: { foreground: '#7CC4FF', background: '#142F49' },
    offline: { foreground: '#6DDDD0', background: '#123936' },
    settings: { foreground: '#C0CDDC', background: '#2B3544' },
    services: { foreground: '#FFD083', background: '#432F15' },
    trucks: { foreground: '#9CCBFF', background: '#1D304A' },
  },
};
export function MoreScreen({
  services,
  onTrucks,
  onSettings,
  onServices,
}: {
  services: Services;
  onTrucks: () => void;
  onSettings: () => void;
  onServices: () => void;
}) {
  const palette = useDriverPalette();
  const iconColors = featureIconColors[palette.dark ? 'night' : 'day'];
  const auth = useStore(services.auth),
    trucks = useStore(services.trucks);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState('');
  async function inspectAccountServices() {
    if (busy) return;
    setBusy(true);
    setError('');
    const account = services.auth.getSnapshot().user?.id;
    try {
      const connections = z
        .object({
          items: z.array(
            z.object({ provider: z.string(), status: z.string() }),
          ),
        })
        .parse(await services.api.request('GET', '/eld/connections'));
      const hos = z
        .object({ status: z.literal('UNKNOWN'), reason: z.string() })
        .parse(await services.api.request('GET', '/eld/hos/current'));
      let billing = 'Billing unavailable';
      try {
        const e = await services.api.request<{ accessState: string }>(
          'GET',
          '/entitlements',
        );
        billing =
          'Entitlement: ' +
          (typeof e.accessState === 'string'
            ? e.accessState
            : 'See account support');
      } catch (e) {
        if ((e as { code?: string }).code === 'BILLING_DISABLED')
          billing = 'Billing disabled';
        else throw e;
      }
      if (services.auth.getSnapshot().user?.id === account)
        setProviderStatus(
          (connections.items.length
            ? connections.items
                .map(c => c.provider + ': ' + c.status)
                .join('; ')
            : 'No ELD connection') +
            '. HOS unknown (' +
            (hos.reason === 'ELD_DATA_STALE'
              ? 'provider data is stale'
              : hos.reason === 'DRIVER_MAPPING_REQUIRED'
              ? 'verified driver mapping required'
              : 'no connected provider') +
            '). ' +
            billing +
            '.',
        );
    } catch (e) {
      if (services.auth.getSnapshot().user?.id === account)
        setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DriverPage>
      <View style={ds.row}>
        <View style={ds.grow}>
          <DriverTitle>More</DriverTitle>
        </View>
        <DriverButton
          title="Sign out"
          secondary
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void services.auth
              .logout()
              .catch(() => setError('Could not sign out. Please retry.'))
              .finally(() => setBusy(false));
          }}
        />
      </View>
      <DriverCard>
        <View style={ds.row}>
          <DriverIcon name="person" size={32} />
          <View style={ds.grow}>
            <DriverTitle small>{auth.user?.fullName || 'Driver'}</DriverTitle>
            <DriverCopy>
              {auth.user?.email} · {auth.user?.plan || 'Plan unavailable'}
            </DriverCopy>
          </View>
        </View>
      </DriverCard>
      <View style={[styles.premium, { backgroundColor: palette.card }]}>
        <DriverIcon name="workspace_premium_rounded" size={32} />
        <Text style={[styles.premiumTitle, { color: palette.text }]}>
          SemiTraX Premium
        </Text>
        <Text style={[styles.premiumCopy, { color: palette.muted }]}>
          Trial, monthly, annual, and fleet plans
        </Text>
        <Text style={[styles.premiumCopy, { color: palette.muted }]}>
          Subscription management is not available in this version.
        </Text>
      </View>
      <DriverTile
        icon="cable_rounded"
        iconColors={iconColors.eld}
        title="ELD connections"
        caption="Read provider connection and HOS availability; no guessed driving hours"
        disabled={busy}
        onPress={() => {
          void inspectAccountServices();
        }}
      />
      {!!providerStatus && <DriverCopy>{providerStatus}</DriverCopy>}
      <DriverTile
        icon="map"
        iconColors={iconColors.offline}
        title="Offline maps"
        caption="Map region downloads — not available in this version"
        disabled
      />
      <DriverTile
        icon="settings_rounded"
        iconColors={iconColors.settings}
        title="Account and settings"
        caption="Profile, units and navigation preferences"
        onPress={onSettings}
      />
      <DriverTile
        icon="warning_amber_rounded"
        iconColors={iconColors.services}
        title="Road and truck services"
        caption="Provider restrictions and road conditions for your route"
        onPress={onServices}
      />
      <DriverTitle small>Truck profiles</DriverTitle>
      {trucks.profiles.length === 0 ? (
        <DriverCopy>
          Add a truck profile before calculating a commercial route.
        </DriverCopy>
      ) : (
        trucks.profiles.map(truck => (
          <DriverTile
            key={truck.id}
            icon="local_shipping_rounded"
            iconColors={iconColors.trucks}
            title={
              truck.name + (trucks.selected?.id === truck.id ? ' · Active' : '')
            }
            caption={
              truck.heightFt +
              ' ft H · ' +
              truck.widthFt +
              ' ft W · ' +
              truck.lengthFt +
              ' ft L · ' +
              truck.weightLbs +
              ' lbs · ' +
              truck.axleCount +
              ' axles'
            }
            onPress={onTrucks}
          />
        ))
      )}
      <DriverButton title="Manage / add truck" onPress={onTrucks} />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
    </DriverPage>
  );
}
const styles = StyleSheet.create({
  premium: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#102638',
    gap: 8,
  },
  premiumTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  premiumCopy: { color: '#C4D0D8', lineHeight: 20 },
});
