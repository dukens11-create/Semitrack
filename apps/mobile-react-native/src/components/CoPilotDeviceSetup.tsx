import { useDriverPalette } from './DriverUI';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  deviceLicenseSchema,
  DeviceActivationError,
  openDeviceActivation,
  readDeviceLicense,
} from '../services/copilot/DeviceActivation';
import {
  checkEmbeddedSetup,
  embeddedSetupMessage,
  EmbeddedSetupError,
} from '../services/copilot/EmbeddedSetup';

export function CoPilotDeviceSetup() {
  const p = useDriverPalette();
  const [companyId, setCompanyId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const check = useRef<AbortController | null>(null);
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
      check.current?.abort();
    };
  }, []);
  async function setupEmbedded() {
    const parsed = deviceLicenseSchema.safeParse({ companyId, assetId });
    if (!parsed.success) {
      setMessage(
        'Enter valid company and device IDs, matching Account Manager exactly.',
      );
      return;
    }
    const controller = new AbortController();
    check.current = controller;
    setBusy(true);
    setMessage(
      'Checking embedded CoPilot. Keep SemiTraX open; this can take up to 45 seconds.',
    );
    try {
      const report = await checkEmbeddedSetup(parsed.data, controller.signal);
      if (!controller.signal.aborted) setMessage(embeddedSetupMessage(report));
    } catch (error) {
      if (!controller.signal.aborted) {
        const code =
          error instanceof EmbeddedSetupError
            ? error.code
            : 'COPILOT_CHECK_FAILED';
        setMessage(
          code === 'COPILOT_LOCATION_REQUIRED'
            ? 'Allow precise location for SemiTraX in Android Settings, then retry.'
            : code === 'COPILOT_RESTART_REQUIRED'
            ? 'Close and restart SemiTraX before changing the company or device ID.'
            : code === 'COPILOT_FOREGROUND_REQUIRED'
            ? 'Keep SemiTraX open during setup, then retry.'
            : code === 'DEVICE_SETTINGS_SAVE_FAILED'
            ? 'Could not securely save device settings. Restart SemiTraX and retry.'
            : `Embedded CoPilot setup could not complete (${code}). Navigation remains unavailable. Share this message for diagnosis.`,
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
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
        Embedded CoPilot setup
      </Text>
      <Text style={[styles.text, { color: p.text }]}>
        Enter the company and device IDs assigned in Trimble Account Manager,
        matching capitalization exactly. Check setup inside SemiTraX to verify
        the embedded engine, license and map inventory. Each device needs its
        own assigned license. This check does not start navigation.
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
        accessibilityLabel="Check CoPilot setup inside SemiTraX"
        disabled={busy}
        onPress={() => {
          void setupEmbedded();
        }}
        style={styles.button}
      >
        <Text style={styles.text}>
          {busy ? 'Please wait…' : 'Check setup inside SemiTraX'}
        </Text>
      </Pressable>
      <Text style={[styles.text, { color: p.text }]}>
        Separate CoPilot app: if Trimble supplied a standalone Truck app for
        this license, you can open its activation here. Its activation does not
        verify the embedded engine in SemiTraX.
      </Text>
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
