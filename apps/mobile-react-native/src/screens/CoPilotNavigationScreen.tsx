import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  CopilotOfflineMap,
  copilotMapBlocker,
} from '../components/CopilotOfflineMap';
import {
  DriverButton,
  DriverCopy,
  useDriverPalette,
} from '../components/DriverUI';
import { useCopilotState } from '../services/copilot/CopilotProvider';
import { coPilotHost } from '../services/copilot/CoPilotHost';

import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import { DriverIcon } from '../components/DriverIcon';
import { WeatherStatus } from '../features/weather/WeatherStatus';

function CurrentWeather({
  services,
  active,
}: {
  services: Services;
  active: boolean;
}) {
  useEffect(() => {
    if (active) void services.location.start().catch(() => {});
  }, [services, active]);
  const location = useStore(services.location);
  const routes = useStore(services.routes);
  return (
    <WeatherStatus
      services={services}
      route={routes.route}
      fix={location.fix}
    />
  );
}

/** CoPilot owns the visible trip, search, preferences and navigation controls. */
export function CoPilotNavigationScreen({
  active = true,
  services,
}: {
  active?: boolean;
  services?: Services;
}) {
  const state = useCopilotState();
  const palette = useDriverPalette();
  const allowed = copilotMapBlocker(state) === null;
  const prepared = useRef(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!allowed) {
      prepared.current = false;
      return;
    }
    // Let startup dialogs finish before opening the native navigation screen.
    if (!active || !state.readyToAddStops || prepared.current) return;
    let current = true;
    void coPilotHost()
      .mapCommand('native-map')
      .then(() => {
        if (!current) return;
        prepared.current = true;
        setError(false);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [active, allowed, state.readyToAddStops, retry]);
  return (
    <View style={styles.screen}>
      {allowed && state.readyToAddStops && (
        <View style={[styles.toolbar, palette.dark ? styles.toolbarDark : styles.toolbarLight]}>
          <View style={styles.brand} accessibilityLabel="SemiTraX navigation">
            <DriverIcon name="local_shipping_rounded" size={25} color="#FFFFFF" />
            <View>
              <Text style={styles.wordmark}>SemiTra<Text style={styles.brandX}>X</Text></Text>
              <Text style={styles.caption}>Powered by Trimble</Text>
            </View>
          </View>
          {services && (
            <View style={styles.weather}>
              <CurrentWeather services={services} active={active} />
            </View>
          )}
        </View>
      )}
      <CopilotOfflineMap state={state} />
      {error && (
        <View accessibilityRole="alert">
          <DriverCopy>
            CoPilot controls could not open. Retry or check setup in Details.
          </DriverCopy>
          <DriverButton
            title="Retry CoPilot controls"
            onPress={() => {
              prepared.current = false;
              setRetry(value => value + 1);
            }}
          />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  toolbarDark: { backgroundColor: '#102E46' },
  toolbarLight: { backgroundColor: '#104A70' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  brandX: { color: '#8DD8FF' },
  caption: { color: '#D0E6F3', fontSize: 10, fontWeight: '500' },
  weather: { flexShrink: 1 },
});
