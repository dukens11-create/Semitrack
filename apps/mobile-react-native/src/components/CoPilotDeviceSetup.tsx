import { embeddedSession } from '../services/copilot/EmbeddedSession';
import { useSyncExternalStore } from 'react';
import { useDriverPalette } from './DriverUI';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  deviceLicenseSchema,
  readDeviceLicense,
} from '../services/copilot/DeviceActivation';
import { embeddedSetupMessage } from '../services/copilot/EmbeddedSetup';
import { CoPilotMapDownloads } from './CoPilotMapDownloads';

export function CoPilotDeviceSetup() {
  const p = useDriverPalette();
  const [companyId, setCompanyId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const session = useSyncExternalStore(
    embeddedSession.subscribe,
    embeddedSession.getSnapshot,
  );
  const [mapsAvailable, setMapsAvailable] = useState(false);
  const working = busy || session.phase === 'restoring';

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
  async function setupEmbedded() {
    const parsed = deviceLicenseSchema.safeParse({ companyId, assetId });
    if (!parsed.success) {
      setMessage(
        'Enter valid company and device IDs, matching Account Manager exactly.',
      );
      return;
    }
    setBusy(true);
    await embeddedSession.ensure(parsed.data);
    const result = embeddedSession.getSnapshot();
    setMessage(
      result.report
        ? embeddedSetupMessage(result.report)
        : result.error ?? 'Setup not completed. Retry while SemiTraX is open.',
    );
    setMapsAvailable(
      !!result.report?.fullNavigationLicensed &&
        !!result.report?.heavyTruckLicensed,
    );
    setBusy(false);
  }
  return (
    <View style={styles.form}>
      <Text style={[styles.text, { color: p.text }]}>
        Embedded CoPilot setup
      </Text>
      <Text style={[styles.text, { color: p.text }]}>
        Use this device’s assigned Trimble company and device IDs. Saved
        settings are restored automatically. Never reuse another device’s
        license.
      </Text>
      <TextInput
        style={[styles.input, { color: p.text, backgroundColor: p.input }]}
        accessibilityLabel="CoPilot Company ID"
        placeholder="Company ID"
        placeholderTextColor={p.muted}
        value={companyId}
        onChangeText={value => {
          setCompanyId(value);
          setMapsAvailable(false);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!working}
      />
      <TextInput
        style={[styles.input, { color: p.text, backgroundColor: p.input }]}
        accessibilityLabel="CoPilot Device ID"
        placeholder="Device ID"
        placeholderTextColor={p.muted}
        value={assetId}
        onChangeText={value => {
          setAssetId(value);
          setMapsAvailable(false);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!working}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check CoPilot setup inside SemiTraX"
        disabled={working}
        onPress={() => {
          void setupEmbedded();
        }}
        style={styles.button}
      >
        <Text style={styles.text}>
          {working ? 'Please wait…' : 'Check setup inside SemiTraX'}
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
      {(mapsAvailable ||
        (session.report?.fullNavigationLicensed &&
          session.report?.heavyTruckLicensed)) && <CoPilotMapDownloads />}
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
