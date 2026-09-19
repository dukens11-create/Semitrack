import { useDriverPalette } from './DriverUI';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CopilotLifecycle,
  initialCopilotState,
} from '../services/copilot/CopilotLifecycle';
import { createCopilotRuntime } from '../services/copilot/CopilotRuntime';

/** Non-blocking status; backend setup/authentication remains independent. */
export function CopilotStatus() {
  const p = useDriverPalette();
  const [state, setState] = useState(initialCopilotState);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const lifecycle = new CopilotLifecycle(createCopilotRuntime(), next => {
      setState(next);
      if (__DEV__)
        console.info(
          '[SemiTraX CoPilot]',
          JSON.stringify({
            phase: next.phase,
            error: next.error,
            operation: next.operation,
            modules: next.modules,
            initialized: next.initialized,
            licensingReady: next.licensingReady,
            fullNavigationLicensed: next.fullNavigationLicensed,
            heavyTruckLicensed: next.heavyTruckLicensed,
            mapsReady: next.mapsReady,
            readyToAddStops: next.readyToAddStops,
            copilotReady: next.copilotReady,
            lastEvent: next.lastEvent,
          }),
        );
    });
    void lifecycle.start();
    return () => lifecycle.dispose();
  }, []);
  if (state.warning)
    return (
      <View
        style={[styles.warning, { backgroundColor: p.warningSurface }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Text style={[styles.warningText, { color: p.warningText }]}>
          {state.warning}
        </Text>
      </View>
    );
  const label = state.copilotReady
    ? 'CoPilot setup checked · Navigation not started'
    : state.phase === 'NOT_STARTED' || state.phase === 'STARTING'
    ? 'CoPilot setup pending'
    : state.error === 'COPILOT_MAP_DATA_REQUIRED'
    ? 'CoPilot maps required'
    : state.error === 'COPILOT_LICENSE_PROVISIONING_REQUIRED'
    ? 'CoPilot provisioning required'
    : 'CoPilot turn-by-turn unavailable';
  const message = state.copilotReady
    ? 'CoPilot setup checks passed. Active truck navigation still requires verification.'
    : state.error === 'COPILOT_MAP_DATA_REQUIRED'
    ? 'Navigation is unavailable until licensed CoPilot maps are installed and verified.'
    : 'CoPilot turn-by-turn has not passed provisioning, maps and startup acceptance. License status is unverified; this is not a confirmed license rejection. Truck-route planning has its own status.';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + '. View CoPilot status'}
        onPress={() => setDetails(true)}
        style={[styles.status, { backgroundColor: p.canvas }]}
      >
        <View style={styles.dot} />
        <Text numberOfLines={1} style={[styles.text, { color: p.muted }]}>
          {label}
        </Text>
        <Text
          style={[
            styles.details,
            p.dark ? styles.nightAction : styles.dayAction,
          ]}
        >
          Details
        </Text>
      </Pressable>
      <Modal
        visible={details}
        transparent
        animationType="fade"
        onRequestClose={() => setDetails(false)}
      >
        <View style={styles.scrim}>
          <View style={[styles.card, { backgroundColor: p.card }]}>
            <Text style={[styles.title, { color: p.text }]}>
              CoPilot navigation
            </Text>
            <Text style={[styles.message, { color: p.muted }]}>{message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close CoPilot status"
              onPress={() => setDetails(false)}
              style={styles.close}
            >
              <Text
                style={[
                  styles.closeText,
                  p.dark ? styles.nightAction : styles.dayAction,
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  nightAction: { color: '#F0A45A' },
  dayAction: { color: '#9F341E' },
  status: {
    minHeight: 32,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#0C131B',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F0A45A' },
  text: { color: '#C5CFD8', fontSize: 11, flexShrink: 1 },
  details: { color: '#F0A45A', fontSize: 11, fontWeight: '700' },
  scrim: {
    flex: 1,
    padding: 28,
    justifyContent: 'center',
    backgroundColor: '#00000088',
  },
  card: { padding: 24, borderRadius: 20, backgroundColor: '#172534', gap: 16 },
  title: { color: 'white', fontSize: 20, fontWeight: '700' },
  message: { color: '#C5CFD8', fontSize: 15, lineHeight: 22 },
  close: { alignSelf: 'flex-end', padding: 12 },
  closeText: { color: '#FF8A50', fontSize: 16, fontWeight: '700' },
  warning: { padding: 16, backgroundColor: '#8B0000' },
  warningText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
