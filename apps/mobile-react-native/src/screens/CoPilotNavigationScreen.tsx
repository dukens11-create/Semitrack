import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  CopilotOfflineMap,
  copilotMapBlocker,
} from '../components/CopilotOfflineMap';
import { DriverButton, DriverCopy } from '../components/DriverUI';
import { useCopilotState } from '../services/copilot/CopilotProvider';
import { coPilotHost } from '../services/copilot/CoPilotHost';

/** CoPilot owns the visible trip, search, preferences and navigation controls. */
export function CoPilotNavigationScreen({
  active = true,
}: {
  active?: boolean;
}) {
  const state = useCopilotState();
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
  async function open(command: string) {
    if (!active || !allowed || !state.readyToAddStops) return;
    try {
      await coPilotHost().mapCommand(command);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <View style={styles.screen}>
      {allowed && state.readyToAddStops && (
        <View style={styles.controls}>
          {(
            [
              ['CoPilot menu', 'copilot-menu'],
              ['Trip plan', 'trip-plan'],
              ['CoPilot settings', 'settings'],
              ['Return to map', 'map'],
            ] as const
          ).map(([title, command]) => (
            <View key={command} style={styles.action}>
              <DriverButton
                title={title}
                secondary
                onPress={() => {
                  void open(command);
                }}
              />
            </View>
          ))}
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
  controls: { flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 4 },
  action: { width: '49%' },
});
