import { useDriverPalette } from './DriverUI';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  deviceLicenseSchema,
  DeviceActivationError,
  openDeviceActivation,
  readDeviceLicense,
} from '../services/copilot/DeviceActivation';

export function CoPilotDeviceSetup() {
  const p = useDriverPalette();
  const [companyId, setCompanyId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    void readDeviceLicense()
      .then(value => {
        if (alive && value) {
          setCompanyId(value.companyId);
          setAssetId(value.assetId);
        }
      })
      .catch(() => {
        if (alive) setMessage('Could not read saved device settings.');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function activate() {
    const parsed = deviceLicenseSchema.safeParse({ companyId, assetId });
    if (!parsed.success) {
      setMessage('Enter valid company and device IDs.');
      return;
    }
    setBusy(true);
    try {
      await openDeviceActivation(parsed.data);
      setMessage(
        'CoPilot opened. Complete activation there, then verify Activated in Account Manager. Embedded navigation remains unverified.',
      );
    } catch (error) {
      setMessage(
        error instanceof DeviceActivationError &&
          error.code === 'COPILOT_APP_UNAVAILABLE'
          ? 'No installed app can open CoPilot activation. Install the CoPilot app supplied for your Trimble license, then retry.'
          : error instanceof DeviceActivationError &&
            error.code === 'DEVICE_SETTINGS_SAVE_FAILED'
          ? 'Could not save device settings securely. Restart SemiTraX and retry.'
          : 'CoPilot activation could not open. Open CoPilot directly and check its setup, then retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.form}>
      <Text style={[styles.text, { color: p.text }]}>
        Device license activation
      </Text>
      <Text style={[styles.text, { color: p.text }]}>
        Install the CoPilot Truck app supplied for your Trimble license. Use the
        IDs assigned to this device in Account Manager. Each device needs a
        separate license. This opens the separate CoPilot app.
      </Text>
      <TextInput
        style={[styles.input, { color: p.text, backgroundColor: p.input }]}
        accessibilityLabel="CoPilot Company ID"
        placeholder="Company ID"
        placeholderTextColor={p.muted}
        value={companyId}
        onChangeText={setCompanyId}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <TextInput
        style={[styles.input, { color: p.text, backgroundColor: p.input }]}
        accessibilityLabel="CoPilot Device ID"
        placeholder="Device ID"
        placeholderTextColor={p.muted}
        value={assetId}
        onChangeText={setAssetId}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open CoPilot to activate device"
        disabled={busy}
        onPress={() => {
          void activate();
        }}
        style={styles.button}
      >
        <Text style={styles.text}>
          {busy ? 'Please wait…' : 'Open CoPilot to activate'}
        </Text>
      </Pressable>
      {!!message && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.text, { color: p.text }]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: 12 },
  text: { color: '#FFFFFF' },
  input: {
    color: '#FFFFFF',
    borderColor: '#64748B',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  button: { backgroundColor: '#1267B1', padding: 14, borderRadius: 8 },
});
