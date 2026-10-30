import { coPilotHost } from '../services/copilot/CoPilotHost';
import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { DriverButton, useDriverPalette } from './DriverUI';
import {
  enginePreferences,
  readEnginePreference,
  writeEnginePreference,
  type EnginePreference,
} from '../services/copilot/EnginePreferences';
import {
  readCoPilotPlaces,
  setCoPilotPlaceVisible,
  type CoPilotPoiCategory,
} from '../services/copilot/CoPilotPlaces';

const keys = Object.keys(enginePreferences) as EnginePreference[];
/** Reads actual SDK values; a failed write never becomes a confirmed local preference. */
export function CoPilotFeatureControls({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const p = useDriverPalette();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<
    Partial<Record<EnginePreference, boolean>>
  >({});
  const [places, setPlaces] = useState<CoPilotPoiCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const locked = useRef(false);
  async function refresh(ticket: number) {
    const results = await Promise.allSettled([
      ...keys.map(readEnginePreference),
      readCoPilotPlaces(),
    ]);
    if (ticket !== generation.current || AppState.currentState !== 'active')
      return;
    const next: Partial<Record<EnginePreference, boolean>> = {};
    keys.forEach((key, i) => {
      const result = results[i];
      if (result?.status === 'fulfilled' && typeof result.value === 'boolean')
        next[key] = result.value;
    });
    const catalog = results[keys.length];
    setValues(next);
    setPlaces(
      catalog?.status === 'fulfilled' && Array.isArray(catalog.value)
        ? catalog.value
        : [],
    );
    setError(
      results.some(result => result.status === 'rejected')
        ? 'Some Trimble settings could not be read. Close and reopen to retry.'
        : '',
    );
  }
  useEffect(() => {
    if (!open || disabled) return;
    const reload = () => {
      setValues({});
      setPlaces([]);
      void refresh(++generation.current);
    };
    reload();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') reload();
      else {
        generation.current++;
        setValues({});
        setPlaces([]);
      }
    });
    return () => {
      // Invalidate in-flight SDK reads after closing this panel.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      subscription.remove();
    };
  }, [open, disabled]);
  async function change(action: () => Promise<unknown>) {
    if (locked.current || disabled || AppState.currentState !== 'active')
      return;
    locked.current = true;
    setBusy(true);
    const ticket = ++generation.current;
    try {
      await action();
      await refresh(ticket);
    } catch {
      if (ticket === generation.current) {
        setValues({});
        setPlaces([]);
        setError(
          'Trimble did not confirm this change. Close and reopen to read the current settings.',
        );
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <DriverButton
        title="Trimble map and guidance settings"
        secondary
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open && !disabled}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={[styles.screen, { backgroundColor: p.canvas }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.title, { color: p.text }]}>
              Trimble map and guidance settings
            </Text>
            {!!error && (
              <Text accessibilityRole="alert" style={{ color: p.text }}>
                {error}
              </Text>
            )}
            {[
              ['2D map', 'two-dimensional'],
              ['3D map', 'three-dimensional'],
              ['Heading up', 'heading-up'],
              ['North up', 'north-up'],
              ['Follow truck', 'recenter'],
            ].map(([label, command]) => (
              <DriverButton
                key={command}
                title={label!}
                secondary
                disabled={busy}
                onPress={() => {
                  void change(() => coPilotHost().mapCommand(command!));
                }}
              />
            ))}
            {keys.map(key => (
              <View key={key} style={styles.row}>
                <Text style={[styles.label, { color: p.text }]}>
                  {enginePreferences[key].label}
                  {values[key] === undefined ? ' · unavailable' : ''}
                </Text>
                <Switch
                  accessibilityLabel={enginePreferences[key].label}
                  disabled={busy || values[key] === undefined}
                  value={values[key] ?? false}
                  onValueChange={value => {
                    void change(() => writeEnginePreference(key, value));
                  }}
                />
              </View>
            ))}
            <Text style={[styles.title, { color: p.text }]}>
              Places shown on the Trimble map
            </Text>
            {places.map(place => (
              <View key={place.id} style={styles.row}>
                <Text style={[styles.label, { color: p.text }]}>
                  {place.name}
                </Text>
                <Switch
                  accessibilityLabel={`Show ${place.name}`}
                  value={place.visible}
                  disabled={busy}
                  onValueChange={value => {
                    void change(() => setCoPilotPlaceVisible(place.id, value));
                  }}
                />
              </View>
            ))}
            <Text style={{ color: p.text }}>
              Available categories come from your installed Trimble maps. Live
              prices and parking availability require separate provider data.
            </Text>
          </ScrollView>
          <DriverButton
            title="Close Trimble settings"
            onPress={() => setOpen(false)}
          />
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24 },
  content: { gap: 16, paddingVertical: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  label: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700' },
});
