import { Alert } from './ThemedAlert';
import { NativeModules } from 'react-native';
import { amsSetupExplanation } from '../services/copilot/CopilotLicenseDiagnostics';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { coPilotDiagnosticReport } from '../services/copilot/CoPilotDiagnosticReport';
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
    {
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
  async function shareDiagnostics() {
    if (busy) return;
    setBusy(true);
    try {
      const host = coPilotHost();
      if (!host.setupDiagnostics) throw new Error('Diagnostics unavailable');
      const fresh = await host.setupDiagnostics();
      const report = coPilotDiagnosticReport(fresh, state);
      setDiagnostics(fresh);
      const result = await Share.share({
        title: 'SemiTraX CoPilot diagnostics',
        message: report,
      });
      if (result.action === Share.sharedAction)
        setMessage(
          'Diagnostic report shared. Send it in this chat for review.',
        );
    } catch {
      setMessage(
        'Could not share diagnostics. Try again while SemiTraX is open.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function repair() {
    if (busy) return;
    setBusy(true);
    try {
      const host = coPilotHost();
      if (!host.repairAssignedSetup) throw new Error('Repair unavailable');
      await host.repairAssignedSetup();
      setMessage(
        'Saved Company ID typo corrected. Use Android Settings → Apps → SemiTraX → Force stop, then reopen once to start a fresh SemiTraX login. Maps and licenses are preserved.',
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
        'Device setup saved and SemiTraX started. License and California map checks continue automatically.',
      );
    } catch {
      setMessage(
        'SemiTraX startup did not complete. See the setup stage below. Existing licenses and maps are preserved.',
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
      {diagnostics?.buildIdentity && (
        <Text selectable style={{ color: palette.text }}>
          {`Hybrid ${diagnostics.buildIdentity.versionName} (${diagnostics.buildIdentity.versionCode})\n${diagnostics.buildIdentity.packageName} · ${diagnostics.buildIdentity.variant}\nCommit ${diagnostics.buildIdentity.commit}\nBuilt ${diagnostics.buildIdentity.builtAt}`}
        </Text>
      )}
      <Text style={{ color: palette.muted }}>
        Use the Company ID and Device ID assigned to this phone. Setup is saved
        securely and restored automatically. California maps use Wi-Fi by
        default. If you have no Wi-Fi, allow mobile data below and keep SemiTraX
        open.
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
            accessibilityLabel="SemiTraX Company ID"
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
            accessibilityLabel="SemiTraX Device ID"
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
            accessibilityLabel="Save SemiTraX device setup"
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
        accessibilityLabel="Retry saved SemiTraX setup"
        disabled={busy}
        onPress={() => {
          void retry();
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Retry saved setup</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share CoPilot diagnostics"
        disabled={busy}
        onPress={() => {
          void shareDiagnostics();
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Share diagnostics</Text>
      </Pressable>
      <Text style={{ color: palette.muted }}>
        Shares setup checks and a native login timeline from this app session.
        Passwords, IDs and location are excluded.
      </Text>
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
          Login response: {diagnostics.loginResponse}.{'\n'}
          SDK Device ID setup:{' '}
          {diagnostics.deviceConfigurationStatus ?? 'Not reported'}.{'\n'}
          SDK readback: {diagnostics.deviceReadbackKind ?? 'Not reported'}.
        </Text>
      )}
      {diagnostics?.appStorage && (
        <Text style={{ color: palette.text }}>
          {diagnostics.appStorage.status === 'AVAILABLE' &&
          Number.isFinite(diagnostics.appStorage.availableBytes)
            ? `Android storage available to SemiTraX: ${(
                (diagnostics.appStorage.availableBytes ?? 0) / 1_000_000_000
              ).toFixed(
                2,
              )} GB. This measures the app's storage volume; it does not confirm that a map download can start.`
            : 'Android app storage could not be measured.'}
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
      {!state.mapsReady && state.licensingReady && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download SemiTraX maps using mobile data"
            disabled={busy || setup.cellularAllowed}
            style={styles.button}
            onPress={() =>
              Alert.alert(
                'Download maps using mobile data?',
                'Offline maps can use a large amount of data. Your carrier may charge for it. Mobile data will be allowed for this app session.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Allow mobile data',
                    onPress: () => {
                      void setup.allowCellularDownload().catch(() => {
                        setMessage(
                          'Could not enable mobile-data downloads. Update SemiTraX and try again.',
                        );
                      });
                    },
                  },
                ],
              )
            }
          >
            <Text style={styles.buttonText}>
              {setup.cellularAllowed
                ? 'Mobile data allowed for maps'
                : 'Download maps using mobile data'}
            </Text>
          </Pressable>
          <Text style={{ color: palette.muted }}>
            Navigation stays unavailable until the licensed offline map is
            installed and verified.
          </Text>
        </>
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
