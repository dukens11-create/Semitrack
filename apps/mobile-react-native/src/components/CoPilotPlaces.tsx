import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DriverButton, useDriverPalette } from './DriverUI';
import {
  readCoPilotPlaces,
  setCoPilotPlaceVisible,
  type CoPilotPoiCategory,
} from '../services/copilot/CoPilotPlaces';
export function CoPilotPlaces() {
  const p = useDriverPalette();
  const locked = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<CoPilotPoiCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setBusy(true);
    setCatalog([]);
    setError('');
    void readCoPilotPlaces()
      .then(value => {
        if (current) setCatalog(value);
      })
      .catch(() => {
        if (current)
          setError(
            'SemiTraX places unavailable. Check maps and install the latest app build.',
          );
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [open, retry]);
  async function toggle(item: CoPilotPoiCategory) {
    if (busy || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      setCatalog(await setCoPilotPlaceVisible(item.id, !item.visible));
    } catch {
      setCatalog([]);
      setError(
        'Visibility could not be confirmed. Refresh before trying again.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="SemiTraX POI categories"
        style={[styles.trigger, { backgroundColor: p.card }]}
        onPress={() => setOpen(true)}
      >
        <Text style={{ color: p.text }}>POI</Text>
      </Pressable>
      <Modal
        visible={open}
        onRequestClose={() => {
          if (!busy) setOpen(false);
        }}
        animationType="slide"
      >
        <View style={[styles.page, { backgroundColor: p.canvas }]}>
          <Text style={[styles.title, { color: p.text }]}>SemiTraX places</Text>
          <Text style={{ color: p.muted }}>
            All categories supplied by your installed SemiTraX catalog. Switches
            control native map icons; zoom in to see places. SemiTraX provider
            searches remain separate.
          </Text>
          <TextInput
            accessibilityLabel="Search SemiTraX categories"
            placeholder="Search categories"
            placeholderTextColor={p.muted}
            value={query}
            onChangeText={setQuery}
            style={[styles.search, { color: p.text, backgroundColor: p.card }]}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: p.danger }}>
              {error}
            </Text>
          )}
          {busy && (
            <Text style={{ color: p.muted }}>Updating SemiTraX places…</Text>
          )}
          <ScrollView style={styles.list}>
            {catalog
              .filter(item =>
                item.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
              .map(item => (
                <View key={item.id} style={styles.row}>
                  <Text style={[styles.name, { color: p.text }]}>
                    {item.name}
                  </Text>
                  <Switch
                    accessibilityLabel={`Show ${item.name} on CoPilot map`}
                    value={item.visible}
                    disabled={busy}
                    onValueChange={() => {
                      void toggle(item);
                    }}
                  />
                </View>
              ))}
          </ScrollView>
          <DriverButton
            title="Refresh categories"
            secondary
            disabled={busy}
            onPress={() => setRetry(value => value + 1)}
          />
          <DriverButton
            title="Close"
            secondary
            disabled={busy}
            onPress={() => setOpen(false)}
          />
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  trigger: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: { flex: 1, padding: 24, paddingTop: 48, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  search: { padding: 12, borderRadius: 12 },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 12 },
  name: { flex: 1, fontSize: 16 },
});
