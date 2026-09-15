import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CopilotLifecycle,
  initialCopilotState,
} from '../services/copilot/CopilotLifecycle';
import { createCopilotRuntime } from '../services/copilot/CopilotRuntime';

/** Non-blocking status; backend setup/authentication remains independent. */
export function CopilotStatus() {
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
        style={styles.warning}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Text style={styles.warningText}>{state.warning}</Text>
      </View>
    );
  const message = state.copilotReady
    ? 'CoPilot setup checks passed. Active truck navigation still requires verification.'
    : state.error === 'COPILOT_MAP_DATA_REQUIRED'
    ? 'Navigation is unavailable until licensed CoPilot maps are installed and verified.'
    : 'Active navigation is unavailable until CoPilot licensing, maps and startup are verified. Map browsing and truck-route planning remain separate.';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Navigation unavailable. View CoPilot status"
        onPress={() => setDetails(true)}
        style={styles.status}
      >
        <View style={styles.dot} />
        <Text numberOfLines={1} style={styles.text}>
          Navigation unavailable
        </Text>
        <Text style={styles.details}>Details</Text>
      </Pressable>
      <Modal
        visible={details}
        transparent
        animationType="fade"
        onRequestClose={() => setDetails(false)}
      >
        <View style={styles.scrim}>
          <View style={styles.card}>
            <Text style={styles.title}>CoPilot navigation</Text>
            <Text style={styles.message}>{message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close CoPilot status"
              onPress={() => setDetails(false)}
              style={styles.close}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
