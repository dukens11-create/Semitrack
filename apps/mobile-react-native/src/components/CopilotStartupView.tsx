import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CopilotState } from '../services/copilot/CopilotLifecycle';
import { useCopilotSetup } from '../services/copilot/CopilotProvider';
import { CopilotOfflineMap, copilotMapBlocker } from './CopilotOfflineMap';
import { DriverButton, useDriverPalette } from './DriverUI';

export function needsCopilotStartupView(state: CopilotState): boolean {
  return !state.readyToAddStops && copilotMapBlocker(state) === null;
}

// The SDK view may contain licensing/setup UI until the route engine is ready.
// Keep it free of planner overlays and never accept terms on the user's behalf.
export function CopilotStartupView({ state }: { state: CopilotState }) {
  const palette = useDriverPalette();
  const setup = useCopilotSetup();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Review any Trimble setup shown below while parked. Then check readiness.',
  );
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await setup.refresh();
      setMessage(
        'Readiness checked. If setup remains visible, complete it or share diagnostics from Details.',
      );
    } catch {
      setMessage(
        'Readiness could not be checked. Share diagnostics from Details.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      testID="copilot-startup-view"
      style={[styles.screen, { backgroundColor: palette.canvas }]}
    >
      <View style={styles.header}>
        <Text style={{ color: palette.text }} accessibilityLiveRegion="polite">
          {message}
        </Text>
        <DriverButton
          title={busy ? 'Checking readiness…' : 'Check readiness'}
          disabled={busy}
          onPress={() => {
            void refresh();
          }}
        />
      </View>
      <CopilotOfflineMap state={state} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 12, gap: 8 },
});
