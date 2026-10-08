import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDriverPalette } from './DriverUI';
import {
  MapDownloadError,
  mapCommand,
  mapProgress,
  readMapCatalog,
  regionLabel,
  responseMessage,
  setMapPanelVisible,
  type MapAction,
  type MapCatalog,
} from '../services/copilot/MapDownloads';

export function CoPilotMapDownloads() {
  const p = useDriverPalette();
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading licensed maps…');
  const mounted = useRef(true);
  const reading = useRef(false);
  const acting = useRef(false);
  async function refresh() {
    if (reading.current || acting.current || AppState.currentState !== 'active')
      return;
    reading.current = true;
    try {
      const result = await readMapCatalog();
      if (mounted.current) {
        setCatalog(result);
        setMessage(previous =>
          previous === 'Loading licensed maps…' ? '' : previous,
        );
      }
    } catch (error) {
      if (mounted.current)
        setMessage(
          responseMessage(
            error instanceof MapDownloadError
              ? error.code
              : 'COPILOT_MAP_OPERATION_FAILED',
          ),
        );
    } finally {
      reading.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    setMapPanelVisible(true);
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      setMapPanelVisible(false);
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  async function command(action: MapAction) {
    if (
      selected === null ||
      acting.current ||
      !catalog?.regions.some(region => region.id === selected)
    )
      return;
    acting.current = true;
    setBusy(true);
    setMessage('Sending map request…');
    try {
      const result = await mapCommand(selected, action);
      if (mounted.current) setMessage(responseMessage(result));
    } catch (error) {
      if (mounted.current)
        setMessage(
          responseMessage(
            error instanceof MapDownloadError
              ? error.code
              : 'COPILOT_MAP_OPERATION_FAILED',
          ),
        );
    } finally {
      acting.current = false;
      if (mounted.current) {
        setBusy(false);
        void refresh();
      }
    }
  }
  const region = catalog?.regions.find(item => item.id === selected);
  const installed =
    catalog?.installed.some(item => item.id === selected) ?? false;
  const initialWaiting =
    !!catalog && !catalog.installed.length && !catalog.initialReady;
  const initialPending =
    !!catalog && !catalog.installed.length && catalog.initialAccepted;
  const downloadBlocked =
    initialWaiting || initialPending || !catalog?.downloadPolicyApplied;
  const active =
    region &&
    [
      'REQUESTING',
      'QUEUED',
      'DOWNLOADING',
      'SUCCEEDED',
      'INSTALLATION_STARTED',
      'INSTALLATION_FINISHED',
      'PAUSED',
      'WAITING_ON_STORAGE_SPACE',
      'FAILURE_DOWNLOADING',
      'FAILURE_DOWNLOADED',
      'FAILURE_PAUSED',
      'FAILURE_INSTALLED',
    ].includes(region.status);
  const controllable =
    !initialPending &&
    region &&
    [
      'QUEUED',
      'DOWNLOADING',
      'PAUSED',
      'WAITING_ON_STORAGE_SPACE',
      'FAILURE_DOWNLOADING',
      'FAILURE_PAUSED',
    ].includes(region.status);
  const paused =
    region &&
    ['PAUSED', 'FAILURE_PAUSED', 'WAITING_ON_STORAGE_SPACE'].includes(
      region.status,
    );
  const visible =
    catalog?.regions
      .filter(item =>
        `${item.name} ${item.label}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .sort((a, b) => regionLabel(a).localeCompare(regionLabel(b))) ?? [];
  const button = (title: string, action: MapAction, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={() => {
        void command(action);
      }}
      style={[styles.button, (busy || disabled) && styles.disabled]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
  return (
    <View style={styles.form}>
      <Text style={[styles.title, { color: p.text }]}>
        Download CoPilot maps
      </Text>
      <Text style={{ color: p.text }}>
        Choose a licensed region. Use Wi-Fi and keep SemiTraX open while
        downloading. This panel keeps the screen awake. Existing maps are kept.
        Map installation does not enable turn-by-turn guidance.
      </Text>
      {catalog && (
        <Text style={{ color: p.muted }}>
          Installed packages: {catalog.installed.length} · Free storage:{' '}
          {(catalog.freeBytes / 1073741824).toFixed(1)} GB
        </Text>
      )}
      {catalog && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {!catalog.downloadPolicyApplied
            ? responseMessage('COPILOT_MAP_DOWNLOAD_POLICY_FAILED')
            : initialPending
            ? responseMessage('COPILOT_MAP_INITIAL_IN_PROGRESS')
            : initialWaiting
            ? responseMessage('COPILOT_MAP_INITIAL_NOT_READY')
            : 'Map manager ready for a download request.'}
        </Text>
      )}
      <TextInput
        accessibilityLabel="Search licensed map regions"
        placeholder="Search California, Nevada, Oregon…"
        placeholderTextColor={p.muted}
        value={search}
        onChangeText={setSearch}
        style={[styles.input, { color: p.text, backgroundColor: p.input }]}
      />
      {!!catalog && !catalog.regions.length && (
        <Text style={{ color: p.text }}>
          No licensed map regions were returned.
        </Text>
      )}
      {visible.slice(0, 12).map(item => (
        <Pressable
          key={item.id}
          accessibilityRole="radio"
          accessibilityState={{
            selected: item.id === selected,
            disabled: busy,
          }}
          disabled={busy}
          onPress={() => setSelected(item.id)}
          style={[
            styles.option,
            {
              borderColor: p.muted,
              backgroundColor: p.input,
            },
            item.id === selected && styles.selected,
          ]}
        >
          <Text style={[styles.optionText, { color: p.text }]}>
            {item.id === selected ? '✓ ' : ''}
            {regionLabel(item)}
          </Text>
          <Text style={{ color: p.muted }}>
            {mapProgress(item, catalog?.installed ?? [])}
          </Text>
        </Pressable>
      ))}
      {visible.length > 12 && (
        <Text style={{ color: p.muted }}>
          Search to narrow {visible.length} licensed regions.
        </Text>
      )}
      {!!catalog && !!search && !visible.length && (
        <Text style={{ color: p.text }}>
          No licensed regions match this search.
        </Text>
      )}
      {region && (
        <View style={styles.form}>
          <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
            {regionLabel(region)} ·{' '}
            {mapProgress(region, catalog?.installed ?? [])}
          </Text>
          {button(
            'Download selected map',
            'download',
            installed || !!active || downloadBlocked,
          )}
          {!!controllable && !installed && (
            <View style={styles.controls}>
              {button('Pause', 'pause', !!paused)}
              {button('Resume', 'resume', !paused)}
              {button('Cancel download', 'cancel')}
            </View>
          )}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          void refresh();
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Refresh map status</Text>
      </Pressable>
      {busy && (
        <ActivityIndicator accessibilityLabel="Map request in progress" />
      )}
      <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
        {catalog && message === 'Loading licensed maps…'
          ? 'Select a region to download.'
          : message}
      </Text>
      <Text style={{ color: p.muted }}>
        Progress reflects CoPilot’s last report. A map is marked Installed only
        when it appears in the installed inventory. Allow extra space for
        installation.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  selected: { borderColor: '#1267B1' },
  optionText: { fontWeight: '700' },
  form: { gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 8,
    padding: 12,
  },
  option: { borderWidth: 2, borderRadius: 8, padding: 12, gap: 4 },
  button: { backgroundColor: '#1267B1', padding: 12, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
