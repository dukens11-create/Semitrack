import { NativeModules } from 'react-native';
import { amsSetupExplanation } from '../services/copilot/CopilotLicenseDiagnostics';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  useCopilotSetup,
  useCopilotState,
} from '../services/copilot/CopilotProvider';
import {
  coPilotHost,
  type CoPilotSetupDiagnostics,
} from '../services/copilot/CoPilotHost';
import { useDriverPalette } from './DriverUI';
export function CoPilotDeviceSetup() {
  const palette = useDriverPalette();
  const setup = useCopilotSetup();
  const state = useCopilotState();
  const automatic =
    NativeModules.SemiTraxCoPilotHost?.automaticAssignedSetup === true;
  const [manual, setManual] = useState(!automatic);
  const [company, setCompany] = useState('');
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] =
    useState<CoPilotSetupDiagnostics | null>(null);
  useEffect(() => {
    let live = true;
    if (automatic) {
      try {
        void coPilotHost()
          .setupDiagnostics?.()
          .then(value => {
            if (live) setDiagnostics(value);
          })
          .catch(() => {});
      } catch {}
    }
    return () => {
      live = false;
    };
  }, [automatic, state.operation, state.error]);
  async function repair() {
    if (busy) return;
    setBusy(true);
    try {
      const host = coPilotHost();
      if (!host.repairAssignedSetup) throw new Error('Repair unavailable');
      await host.repairAssignedSetup();
      setMessage(
        'Saved Company ID typo corrected. Use Android Settings → Apps → SemiTraX → Force stop, then reopen once to start a fresh CoPilot login. Maps and licenses are preserved.',
      );
      setDiagnostics(await host.setupDiagnostics!());
    } catch {
      setMessage(
        'Repair blocked to preserve existing setup. See the setup checks below.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function configure() {
    if (busy) return;
    if (!company.trim() || !device.trim()) {
      setMessage('Enter this phone’s assigned Company ID and Device ID.');
      return;
    }
    setBusy(true);
    setMessage('Saving device setup…');
    try {
      await setup.configure(company, device);
      setCompany('');
      setDevice('');
      setMessage(
        'Device setup saved and CoPilot started. License and California map checks continue automatically.',
      );
    } catch {
      setMessage(
        'CoPilot startup did not complete. See the setup stage below. Existing licenses and maps are preserved.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      await setup.retry();
      setMessage(
        'Saved setup checked. See the license result below. Retrying does not change the saved IDs.',
      );
    } catch {
      setMessage(
        'Allow precise location and check the saved device setup, then retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.container}>
      <Text style={{ color: palette.muted }}>
        Use the Company ID and Device ID assigned to this phone. Setup is saved
        securely and restored automatically. California maps download on Wi-Fi
        while SemiTraX is open.
      </Text>
      {automatic && (
        <>
          <Text style={{ color: palette.text }}>
            This Samsung test build saves its assigned device setup
            automatically. You do not need to enter IDs again. Existing saved
            setup is preserved.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setManual(!manual)}
          >
            <Text style={{ color: palette.text }}>
              {manual ? 'Hide setup fields' : 'Show setup fields'}
            </Text>
          </Pressable>
        </>
      )}
      {manual && (
        <>
          <TextInput
            accessibilityLabel="CoPilot Company ID"
            placeholder="Company ID"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={company}
            onChangeText={setCompany}
            editable={!busy}
            style={[
              styles.input,
              { color: palette.text, borderColor: palette.muted },
            ]}
          />
          <TextInput
            accessibilityLabel="CoPilot Device ID"
            placeholder="Device ID"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={device}
            onChangeText={setDevice}
            editable={!busy}
            style={[
              styles.input,
              { color: palette.text, borderColor: palette.muted },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save CoPilot device setup"
            disabled={busy}
            onPress={() => {
              void configure();
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {busy ? 'Checking setup…' : 'Save device setup'}
            </Text>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry saved CoPilot setup"
        disabled={busy}
        onPress={() => {
          void retry();
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Retry saved setup</Text>
      </Pressable>
      {!!diagnostics && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          Saved Company ID matches assignment:{' '}
          {diagnostics.savedCompanyMatches ? 'Yes' : 'No'}.{'\n'}
          Saved Device ID matches assignment:{' '}
          {diagnostics.savedDeviceMatches ? 'Yes' : 'No'}.{'\n'}
          Credential hook: {diagnostics.credentialHook}.{'\n'}
          Hook supplied assigned pair:{' '}
          {diagnostics.hookMatchedAssigned ? 'Yes' : 'No'}.{'\n'}
          Login callback matches assignment:{' '}
          {diagnostics.callbackMatchedAssigned ? 'Yes' : 'No'}.{'\n'}
          Login response: {diagnostics.loginResponse}.
        </Text>
      )}
      {diagnostics?.canRepairTypo && !diagnostics.restartRequired && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void repair();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Correct saved Company ID typo</Text>
        </Pressable>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          {message}
        </Text>
      )}
      {!!state.error && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          Setup stage: {state.operation ?? state.phase}. Status: {state.error}.
          {state.operation === 'native-modules'
            ? ` Missing components: ${Object.entries(state.modules)
                .filter(([, available]) => !available)
                .map(([name]) => name)
                .join(', ')}.`
            : ''}
        </Text>
      )}
      {!!amsSetupExplanation(state.operation) && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          {amsSetupExplanation(state.operation)}
        </Text>
      )}
      {!!setup.downloadStatus && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          {setup.downloadStatus}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: 12 },
  button: {
    minHeight: 48,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#1266A9',
  },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
});
