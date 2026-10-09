import React from 'react';
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import type { CopilotState } from '../services/copilot/CopilotLifecycle';
import { useDriverPalette } from './DriverUI';

export function copilotMapBlocker(state: CopilotState): string | null {
  if (Platform.OS !== 'android' || !state.modules.CopilotView)
    return 'The CoPilot map renderer is unavailable in this build.';
  if (!state.initialized)
    return 'CoPilot must finish secure setup and native startup before its offline map can open.';
  if (
    !state.licensingReady ||
    !state.fullNavigationLicensed ||
    !state.heavyTruckLicensed
  )
    return 'Verify this device’s Full Navigation and Heavy-Duty Truck licenses before opening the CoPilot map.';
  if (
    !state.mapsReady ||
    !state.maps?.mapsReady ||
    !state.maps.installed.length
  )
    return 'Install and verify the selected licensed CoPilot offline map before opening it.';
  if (state.error)
    return 'CoPilot reported a setup or route error. Resolve it before opening the offline map.';
  return null;
}

// Resolve the SDK view only after the lifecycle gate passes. Its Android
// view manager dereferences CopilotMgr.getView(), which requires native startup.
let NativeMap: React.ComponentType<ViewProps> | undefined;
function VerifiedMap() {
  NativeMap ??= requireNativeComponent<ViewProps>('CopilotView');
  return (
    <NativeMap
      style={styles.map}
      accessibilityLabel="Trimble CoPilot offline map"
    />
  );
}

/** Display only: opening the SDK map does not add stops or enable guidance. */
export function CopilotOfflineMap({ state }: { state: CopilotState }) {
  const p = useDriverPalette();
  const blocker = copilotMapBlocker(state);
  return (
    <View style={[styles.screen, { backgroundColor: p.canvas }]}>
      {blocker ? (
        <View style={styles.blocker} accessibilityRole="alert">
          <Text style={[styles.title, { color: p.text }]}>
            CoPilot map setup required
          </Text>
          <Text style={{ color: p.text }}>{blocker}</Text>
        </View>
      ) : (
        <VerifiedMap />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700' },
  blocker: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
});
