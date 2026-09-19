import { Store } from '../../state/Store';
import type { SettingsState } from './SettingsService';
import type { LocationState } from '../../services/location/LocationService';
const emptySettings = new Store<SettingsState>({
  settings: null,
  phase: 'idle',
});
const emptyLocation = new Store<LocationState>({ fix: null, tracking: false });
import React, { createContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { LocationFix } from '../../services/location/LocationService';
import type { Services } from '../../app/services';
import { useStore } from '../../hooks/useStore';
import { resolveAppearance, type AppearanceMode } from './automaticAppearance';
// Consumers receive an effective theme only; system resolution belongs here.
export const DriverAppearanceContext = createContext<'day' | 'night'>('day');
export function DriverPreferences({
  services,
  children,
  startup,
}: React.PropsWithChildren<{
  services?: Services;
  startup?: { mode: AppearanceMode | null; authenticated: boolean };
}>) {
  const state = useStore(services?.settings ?? emptySettings),
    location = useStore(services?.location ?? emptyLocation);
  const retained = useRef<AppearanceMode | null>(startup?.mode ?? null);
  if (state.settings) retained.current = state.settings.dayNightMode;
  const mode = state.settings?.dayNightMode ?? retained.current;
  const authenticated = startup?.authenticated ?? !!services;
  const [now, setNow] = useState(Date.now());
  const scheme = useColorScheme();
  const [locationSettled, setLocationSettled] = useState(false);
  const lastFix = useRef<LocationFix | null>(null);
  const previous = useRef<'day' | 'night' | undefined>(undefined);
  const presented = useRef(false);
  useEffect(() => {
    if (authenticated) void services?.settings.load().catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [services, authenticated]);
  useEffect(() => {
    if (!mode && authenticated) return;
    if ((mode ?? 'system') !== 'system') return;
    if (!services) {
      setLocationSettled(true);
      return;
    }
    let mounted = true;
    // A short, bounded opportunity for an already-permitted fix. Never prompt
    // for location just to select colors, or hold the app behind a GPS splash.
    const timer = setTimeout(() => setLocationSettled(true), 1200);
    void services.location
      .startIfPermitted()
      .then(() => {
        if (mounted && !services.location.getSnapshot().tracking)
          setLocationSettled(true);
      })
      .catch(() => {
        if (mounted) setLocationSettled(true);
      });
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [services, mode, authenticated]);
  if (location.fix) lastFix.current = location.fix;
  const solar = resolveAppearance(
    mode ?? 'system',
    // LocationService expires routing fixes after 15 seconds. Retain coordinates
    // only for the existing five-minute appearance window, never for routing.
    location.fix ?? lastFix.current,
    Math.max(now, Date.now()),
    previous.current,
  );
  const resolved =
    solar === 'system' ? (scheme === 'dark' ? 'night' : 'day') : solar;
  useEffect(() => {
    if (solar !== 'system') previous.current = solar;
  }, [solar]);
  const waiting =
    (!mode && authenticated) ||
    (!presented.current &&
      (mode ?? 'system') === 'system' &&
      solar === 'system' &&
      !locationSettled);
  if (waiting)
    return (
      <View
        style={styles.loading}
        accessibilityLabel="Loading saved appearance"
      >
        {state.phase === 'error' ? (
          <>
            <Text style={styles.text}>
              Saved preferences could not be loaded.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry saved preferences"
              style={styles.retry}
              onPress={() => {
                void services?.settings.load(true).catch(() => {});
              }}
            >
              <Text style={styles.text}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out on this device"
              style={styles.retry}
              onPress={() => {
                void services?.auth.logout();
              }}
            >
              <Text style={styles.text}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.text}>Loading saved preferences…</Text>
          </>
        )}
      </View>
    );
  presented.current = true;
  return (
    <DriverAppearanceContext.Provider value={resolved}>
      {children}
    </DriverAppearanceContext.Provider>
  );
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#40464C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  text: { color: '#FFFFFF', fontSize: 16, textAlign: 'center' },
  retry: {
    minHeight: 48,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#172433',
  },
});
