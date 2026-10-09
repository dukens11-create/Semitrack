import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCopilotSetup } from '../services/copilot/CopilotProvider';
import { useDriverPalette } from './DriverUI';
export function CoPilotDeviceSetup() {
  const palette = useDriverPalette();
  const setup = useCopilotSetup();
  const [company, setCompany] = useState('');
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
        'Saved. CoPilot checks licensing and California offline maps automatically.',
      );
    } catch {
      setMessage(
        'Setup could not complete. Check the assigned IDs and allow precise location. Existing licenses and maps are preserved.',
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
      setMessage('Saved setup checked.');
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
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
          {message}
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
