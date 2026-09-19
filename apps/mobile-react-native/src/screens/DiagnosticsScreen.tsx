import React, { useState, useSyncExternalStore } from 'react';
import { Clipboard, Share, StyleSheet, Text, View } from 'react-native';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from '../components/DriverUI';
import { Alert } from '../components/ThemedAlert';
import {
  clearRouteDiagnostics,
  routeDiagnosticRevision,
  subscribeRouteDiagnostics,
} from '../features/routing/routeTelemetry';
import { routeDiagnosticReport } from '../features/routing/routeDiagnosticReport';

/** Content of Settings → Diagnostics; Settings owns the themed page and Back. */
export function DiagnosticsScreen() {
  useSyncExternalStore(
    subscribeRouteDiagnostics,
    routeDiagnosticRevision,
    routeDiagnosticRevision,
  );
  const p = useDriverPalette();
  const { events } = routeDiagnosticReport();
  const [notice, setNotice] = useState('');
  function copy() {
    try {
      Clipboard.setString(routeDiagnosticReport().text);
      setNotice('Diagnostics copied.');
    } catch {
      setNotice('Could not copy diagnostics. Try sharing instead.');
    }
  }
  async function share() {
    setNotice('');
    try {
      await Share.share({
        title: 'SemiTraX Route Diagnostics',
        message: routeDiagnosticReport().text,
      });
    } catch {
      setNotice('Could not open sharing. Try copying instead.');
    }
  }
  function confirmClear() {
    Alert.alert(
      'Clear diagnostics?',
      'Only diagnostic history will be cleared. Your routes, truck profiles, account and settings will stay unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Diagnostics',
          style: 'destructive',
          onPress: () => {
            clearRouteDiagnostics();
            setNotice('Diagnostic history cleared.');
          },
        },
      ],
    );
  }
  return (
    <View style={styles.content}>
      <DriverTitle small>Route Diagnostics</DriverTitle>
      <DriverCopy>
        Sanitized route checks only. No addresses, coordinates, account details
        or credentials are included.
      </DriverCopy>
      <DriverCopy>
        Up to 40 events from this app session, oldest first. History resets when
        the app restarts. Copy or share it after reproducing a problem.
      </DriverCopy>
      <View style={styles.actions}>
        <View style={styles.action}>
          <DriverButton
            title="Copy Diagnostics"
            onPress={copy}
            secondary
            disabled={!events.length}
          />
        </View>
        <View style={styles.action}>
          <DriverButton
            title="Share Diagnostics"
            onPress={share}
            secondary
            disabled={!events.length}
          />
        </View>
      </View>
      <DriverButton
        title="Clear Diagnostics"
        onPress={confirmClear}
        secondary
        disabled={!events.length}
      />
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {notice}
        </Text>
      )}
      {!events.length ? (
        <DriverCard>
          <DriverCopy>No route diagnostics recorded yet</DriverCopy>
        </DriverCard>
      ) : (
        <>
          <DriverCopy>
            {events.length} recorded events. NOT_OBSERVED means unavailable.
            Required settings do not prove what the provider received.
          </DriverCopy>
          {events.map((event, index) => (
            <DriverCard key={index}>
              <Text selectable style={[styles.event, { color: p.text }]}>
                {event}
              </Text>
            </DriverCard>
          ))}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  event: { fontSize: 13, lineHeight: 21 },
});
