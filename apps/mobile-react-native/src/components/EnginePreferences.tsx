import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, ScrollView, StyleSheet, View } from 'react-native';
import {
  DriverButton,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from './DriverUI';
import {
  enginePreferences,
  readEnginePreference,
  writeEnginePreference,
  type EnginePreference,
} from '../services/copilot/EnginePreferences';
const keys = Object.keys(enginePreferences) as EnginePreference[];
export function EnginePreferences() {
  const p = useDriverPalette();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<
    Partial<Record<EnginePreference, boolean>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    const refresh = async () => {
      const id = ++revision.current;
      setValues({});
      const results = await Promise.allSettled(keys.map(readEnginePreference));
      if (id !== revision.current) return;
      setValues(
        Object.fromEntries(
          results.flatMap((result, i) =>
            result.status === 'fulfilled' ? [[keys[i], result.value]] : [],
          ),
        ),
      );
    };
    void refresh();
    const sub = AppState.addEventListener('change', state => {
      ++revision.current;
      setValues({});
      if (state === 'active') void refresh();
    });
    return () => {
      // Invalidate async requests; this is a counter, not a rendered node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++revision.current;
      sub.remove();
    };
  }, [open]);
  async function toggle(key: EnginePreference) {
    if (lock.current || values[key] === undefined) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const id = revision.current;
    try {
      const value = await writeEnginePreference(key, !values[key]);
      if (id === revision.current)
        setValues(previous => ({ ...previous, [key]: value }));
    } catch {
      if (id === revision.current) {
        setValues(previous => ({ ...previous, [key]: undefined }));
        setError('Setting could not be confirmed. Reopen to refresh.');
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <DriverButton title="Alerts" secondary onPress={() => setOpen(true)} />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <ScrollView
            style={[styles.panel, { backgroundColor: p.card }]}
            contentContainerStyle={styles.content}
          >
            <DriverTitle small>SemiTraX guidance & alerts</DriverTitle>
            {keys.map(key => (
              <DriverButton
                key={key}
                secondary
                disabled={busy || values[key] === undefined}
                title={`${enginePreferences[key].label}: ${
                  values[key] === undefined
                    ? 'Unavailable'
                    : values[key]
                    ? 'On'
                    : 'Off'
                }`}
                onPress={() => {
                  void toggle(key);
                }}
              />
            ))}
            {!!error && <DriverCopy>{error}</DriverCopy>}
            <DriverCopy>
              Changes are read back from the engine. Turn warnings require an
              active engine route.
            </DriverCopy>
            <DriverButton title="Close" onPress={() => setOpen(false)} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  panel: { maxHeight: '80%' },
  content: { padding: 20, gap: 12 },
});
