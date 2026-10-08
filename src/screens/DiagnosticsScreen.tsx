import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, NativeModules, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View} from 'react-native';

type Outcome = 'PASS' | 'FAIL' | 'PENDING';
type Check = {name: string; outcome: Outcome; detail: string};
const backend = 'https://semitrax-api.onrender.com';
const boolCheck = (name: string, value: unknown, failReason: string): Check => ({
  name, outcome: value === true ? 'PASS' : value === false ? 'FAIL' : 'PENDING',
  detail: value === true ? 'Verified by native Android bridge' : value === false ? failReason : 'Not reported',
});
export function DiagnosticsScreen() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [time, setTime] = useState('');
  const run = useCallback(async () => {
    setRunning(true);
    const list: Check[] = [];
    try {
      if (Platform.OS !== 'android') {
        list.push({name: 'CoPilot native bridge', outcome: 'PENDING', detail: 'Android only'});
      } else {
        const bridge = NativeModules.SemiTraxCopilotMapReadiness as
          | {getStatus?: () => Promise<Record<string, unknown>>} | undefined;
        if (!bridge || typeof bridge.getStatus !== 'function') {
          list.push({name: 'CoPilot native bridge', outcome: 'FAIL', detail: 'Native readiness module unavailable'});
        } else {
          const status = await bridge.getStatus();
          list.push(boolCheck('Location permission', status.locationGranted, 'Location permission is required'));
          list.push(boolCheck('CoPilot SDK initialized', status.initialized, 'SDK startup not confirmed'));
          list.push(boolCheck('CoPilot AMS licensing', status.licensingReady, 'License not verified'));
          list.push(boolCheck('Full navigation entitlement', status.fullNavigationLicensed, 'Full navigation not verified'));
          list.push(boolCheck('Heavy-truck entitlement', status.heavyTruckLicensed, 'Heavy-truck license not verified'));
          list.push(boolCheck('Installed CoPilot maps', status.mapsReady, 'Licensed map inventory not verified'));
          list.push(boolCheck('CoPilot native map view', status.fragmentReady, 'SDK native map view unavailable'));
          list.push({name: 'Native readiness reason', outcome: status.reason === 'READY' ? 'PASS' : 'PENDING', detail: String(status.reason ?? 'Unknown')});
        }
      }
    } catch {
      list.push({name: 'CoPilot native readiness', outcome: 'FAIL', detail: 'Native status query failed'});
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(backend + '/health', {method: 'GET', signal: controller.signal});
      list.push({name: 'SemiTraX backend connectivity', outcome: response.ok ? 'PASS' : 'FAIL', detail: 'HTTP ' + response.status});
    } catch {
      list.push({name: 'SemiTraX backend connectivity', outcome: 'FAIL', detail: 'Health endpoint unreachable'});
    } finally {
      clearTimeout(timeout);
    }
    list.push({name: 'Truck profile and route coverage', outcome: 'PENDING', detail: 'Requires live route and restriction acceptance; never inferred from SDK startup'});
    list.push({name: 'Turn-by-turn guidance', outcome: 'PENDING', detail: 'Disabled until truck-profile, route and on-device acceptance'});
    setChecks(list);
    setTime(new Date().toISOString());
    setRunning(false);
  }, []);
  useEffect(() => {void run();}, [run]);
  const report = ['SemiTraX diagnostics', 'Checked: ' + time, ...checks.map(c => c.outcome + ' | ' + c.name + ' | ' + c.detail)].join('\n');
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>SemiTraX Diagnostics</Text>
      <Text style={styles.note}>Read-only checks. No credentials, private route coordinates, or device identifiers are included. PASS does not authorize truck guidance.</Text>
      {time ? <Text style={styles.time}>Last checked: {time}</Text> : null}
      {checks.map(c => (
        <View key={c.name} style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={[styles.result, c.outcome === 'PASS' ? styles.pass : c.outcome === 'FAIL' ? styles.fail : styles.pending]}>{c.outcome}</Text>
          </View>
          <Text style={styles.detail}>{c.detail}</Text>
        </View>
      ))}
      {running ? <ActivityIndicator color="#FF6B2C" accessibilityLabel="Running diagnostics"/> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Run diagnostics again" disabled={running} onPress={() => {void run();}} style={styles.button}>
        <Text style={styles.buttonText}>Run diagnostics again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Share diagnostics report" disabled={!checks.length || running} onPress={() => {void Share.share({message: report});}} style={styles.button}>
        <Text style={styles.buttonText}>Share diagnostic report</Text>
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#0C131B'},
  content: {padding: 20, paddingBottom: 50, gap: 12},
  title: {color: '#FFFFFF', fontSize: 24, fontWeight: '800'},
  note: {color: '#C5CFD8', fontSize: 13, lineHeight: 20},
  time: {color: '#A7B6C5', fontSize: 12},
  card: {padding: 14, borderRadius: 12, backgroundColor: '#172534', gap: 6},
  header: {flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center'},
  name: {color: '#FFFFFF', fontSize: 15, fontWeight: '700', flex: 1},
  result: {fontSize: 12, fontWeight: '900'},
  pass: {color: '#59D09C'}, fail: {color: '#FF7A7A'}, pending: {color: '#F0B56B'},
  detail: {color: '#C5CFD8', fontSize: 12},
  button: {backgroundColor: '#234B69', padding: 16, borderRadius: 10, alignItems: 'center'},
  buttonText: {color: '#FFFFFF', fontWeight: '800'},
});
