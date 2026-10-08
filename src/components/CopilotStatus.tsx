import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CopilotLifecycle,
  initialCopilotState,
} from '../services/copilot/CopilotLifecycle';
import { createCopilotRuntime } from '../services/copilot/CopilotRuntime';

/** Non-blocking status; backend setup/authentication remains independent. */
export function CopilotStatus() {
  const [state, setState] = useState(initialCopilotState);
  const [details, setDetails] = useState(false);
  const [nativeMapStatus, setNativeMapStatus] = useState<Record<string, unknown> | null>(null);
  const lifecycleRef = useRef<CopilotLifecycle | null>(null);
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
    lifecycleRef.current = lifecycle;
    void lifecycle.start();
    // A rejected first-launch permission or a corrected AMS setup can be
    // retried when the user returns to the app; avoid concurrent restarts.
    const appStateSubscription = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      const phase = lifecycle.snapshot().phase;
      if (phase === 'ERROR' || phase === 'MAPS_REQUIRED') {
        lifecycle.dispose();
        void lifecycle.start();
      }
    });
    return () => {
      appStateSubscription.remove();
      lifecycleRef.current = null;
      lifecycle.dispose();
    };
  }, []);
  useEffect(() => {
    if (!details || Platform.OS !== 'android') return;
    const bridge = NativeModules.SemiTraxCopilotMapReadiness as
      | { getStatus?: () => Promise<unknown> }
      | undefined;
    if (typeof bridge?.getStatus !== 'function') {
      setNativeMapStatus({ reason: 'NATIVE_READINESS_BRIDGE_UNAVAILABLE' });
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const result = await bridge.getStatus!();
        if (active) setNativeMapStatus(result && typeof result === 'object'
          ? result as Record<string, unknown> : { reason: 'INVALID_NATIVE_STATUS' });
      } catch {
        if (active) setNativeMapStatus({ reason: 'NATIVE_STATUS_QUERY_FAILED' });
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [details]);
  const label = state.copilotReady ? 'CoPilot setup checked · Navigation not started'
    : state.phase === 'NOT_STARTED' || state.phase === 'STARTING' ? 'CoPilot setup pending'
    : state.error === 'COPILOT_MAP_DATA_REQUIRED' ? 'CoPilot maps required'
    : state.error === 'COPILOT_LICENSE_PROVISIONING_REQUIRED' ? 'CoPilot provisioning required'
    : 'CoPilot turn-by-turn unavailable';
  const message = state.copilotReady
    ? 'CoPilot setup checks passed. Active truck navigation still requires verification.'
    : state.error === 'COPILOT_MAP_DATA_REQUIRED'
    ? 'Navigation is unavailable until licensed CoPilot maps are installed and verified.'
    : 'CoPilot turn-by-turn has not passed provisioning, maps and startup acceptance. License status is unverified; this is not a confirmed license rejection. Truck-route planning has its own status.';
  return (
    <>
      {state.warning ? (
        <View style={styles.warning} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.warningText}>{state.warning}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + ". View CoPilot status"}
        onPress={() => setDetails(true)}
        style={styles.status}
      >
        <View style={styles.dot} />
        <Text numberOfLines={1} style={styles.text}>
          {label}
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
            <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator>
            <Text style={styles.title}>CoPilot navigation</Text>
            <Text style={styles.message}>{message}</Text>
            <Text style={styles.diagnostics} selectable>
              {                'Phase: ' + (state.phase) +
                '\nBlocker: ' + (state.error ?? 'none') +
                '\nOperation: ' + (state.operation ?? 'none') +
                '\nSDK started: ' + (String(state.initialized)) +
                '\nLicense verified: ' + (String(state.licensingReady)) +
                '\nFull navigation: ' + (String(state.fullNavigationLicensed)) +
                '\nHeavy truck: ' + (String(state.heavyTruckLicensed)) +
                '\nInstalled maps verified: ' + (String(state.mapsReady)) +
                '\nReady for stops: ' + (String(state.readyToAddStops)) +
                '\nLast event: ' + (state.lastEvent ?? 'none')}
            </Text>
            <Text style={styles.diagnostics} selectable>
              {'Licensed map regions: ' + (state.maps?.licensed.join(', ') || 'not reported') +
                '\nInstalled map releases: ' + (state.maps?.installed.length
                  ? state.maps.installed.map(map =>
                      map.set + ': ' + map.year + ' Q' + map.quarter +
                      ' (' + map.versionString + ')').join('; ')
                  : 'not reported') +
                '\nMap update check: ' + (state.maps?.updateStatus ?? 'not checked')}
            </Text>
            <Text style={styles.diagnostics} selectable>
              {'Android map check: ' + String(nativeMapStatus?.reason ?? 'checking') +
                '\nNative view created: ' + String(nativeMapStatus?.fragmentReady ?? false) +
                '\nLocation permission: ' + String(nativeMapStatus?.locationGranted ?? false)}
            </Text>
            {state.phase === 'ERROR' || state.phase === 'MAPS_REQUIRED' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry CoPilot setup checks"
                onPress={() => {
                  const lifecycle = lifecycleRef.current;
                  if (!lifecycle) return;
                  lifecycle.dispose();
                  setState(initialCopilotState());
                  void lifecycle.start();
                }}
                style={styles.close}
              >
                <Text style={styles.closeText}>Retry CoPilot checks</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close CoPilot status"
              onPress={() => setDetails(false)}
              style={styles.close}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
            </ScrollView>
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
  card: { maxHeight: '85%', borderRadius: 20, backgroundColor: '#172534' },
  cardContent: { padding: 24, gap: 16 },
  title: { color: 'white', fontSize: 20, fontWeight: '700' },
  message: { color: '#C5CFD8', fontSize: 15, lineHeight: 22 },
  diagnostics: { color: '#D7E4EF', fontSize: 12, lineHeight: 19 },
  close: { alignSelf: 'flex-end', padding: 12 },
  closeText: { color: '#FF8A50', fontSize: 16, fontWeight: '700' },
  warning: { padding: 16, backgroundColor: '#8B0000' },
  warningText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
