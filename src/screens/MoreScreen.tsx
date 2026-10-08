import React, { useState } from 'react';
import { View, Text } from 'react-native';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverPage,
  DriverTile,
  DriverTitle,
  ds,
} from '../components/DriverUI';
import { DriverIcon } from '../components/DriverIcon';
export function MoreScreen({
  services,
  onTrucks,
  onSettings,
  onServices,
  onEld,
  onOffline,
  onSubscription,
}: {
  services: Services;
  onTrucks: () => void;
  onSettings: () => void;
  onServices: () => void;
  onEld?: () => void;
  onOffline?: () => void;
  onSubscription?: () => void;
}) {
  const auth = useStore(services.auth),
    trucks = useStore(services.trucks);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      <DriverTile
        icon="workspace_premium_rounded"
        title="Subscription & access"
        caption="View read-only account access status; this screen never purchases, renews, cancels or changes billing"
        disabled={!onSubscription}
        onPress={onSubscription}
      />
      <DriverTile
        icon="cable_rounded"
        title="ELD connections"
        caption="Connect, sync or disconnect Samsara/Motive; HOS stays unknown until verified driver mapping"
        disabled={!onEld}
        onPress={onEld}
      />
      <DriverTile
        icon="map"
        title="Offline display maps"
        caption="Download and manage Mapbox display packs; does not enable offline truck routing"
        disabled={!onOffline}
        onPress={onOffline}
      />
      <DriverTile
        icon="settings_rounded"
        title="Account and settings"
        caption="Profile, units and navigation preferences"
        onPress={onSettings}
      />
      <DriverTile
        icon="warning_amber_rounded"
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
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </DriverPage>
  );
}
