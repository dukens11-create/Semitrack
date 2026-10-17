import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DriverButton, useDriverPalette } from './DriverUI';
import {
  readCoPilotVoice,
  setCoPilotMute,
  setCoPilotVolume,
  testCoPilotVoice,
} from '../services/copilot/CoPilotVoice';

/** Mounted only while the native map is ready. Never starts or simulates guidance. */
export function CoPilotVoiceControls() {
  const p = useDriverPalette();
  const [open, setOpen] = useState(false);
  const [state, setState] =
    useState<Awaited<ReturnType<typeof readCoPilotVoice>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      const id = ++generation.current;
      setState(undefined);
      void readCoPilotVoice()
        .then(value => {
          if (id === generation.current) {
            setState(value);
            setError('');
          }
        })
        .catch(() => {
          if (id === generation.current)
            setError(
              'CoPilot voice unavailable. Close and retry when the engine is ready.',
            );
        });
    };
    refresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') refresh();
      else {
        generation.current++;
        setState(undefined);
      }
    });
    return () => {
      // Invalidate requests on cleanup; this ref is a request counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      subscription.remove();
    };
  }, [open]);
  async function run(action: () => Promise<unknown>) {
    if (locked.current || !state) return;
    locked.current = true;
    setBusy(true);
    const id = generation.current;
    try {
      await action();
      const value = await readCoPilotVoice();
      if (id === generation.current) {
        setState(value);
        setError('');
      }
    } catch {
      if (id === generation.current) {
        setState(undefined);
        setError(
          'Voice command could not be confirmed. Close and reopen to refresh.',
        );
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="CoPilot voice controls"
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: p.card }]}
      >
        <Text style={{ color: p.text }}>Voice</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={[styles.panel, { backgroundColor: p.card }]}
          >
            <Text style={[styles.title, { color: p.text }]}>CoPilot voice</Text>
            <Text style={{ color: p.muted }}>
              {state
                ? `${state.muted ? 'Muted' : 'Sound on'} · Volume ${Math.round(
                    state.volume * 100,
                  )}%`
                : error
                ? 'Status unavailable'
                : 'Reading audio settings…'}
            </Text>
            <DriverButton
              title={state?.muted ? 'Unmute guidance' : 'Mute guidance'}
              disabled={busy || !state}
              onPress={() => {
                void run(() => setCoPilotMute(!state!.muted));
              }}
            />
            <View style={styles.row}>
              <DriverButton
                title="Volume −"
                secondary
                disabled={busy || !state || state.volume <= 0}
                onPress={() => {
                  void run(() =>
                    setCoPilotVolume(Math.max(0, state!.volume - 0.1)),
                  );
                }}
              />
              <DriverButton
                title="Volume +"
                secondary
                disabled={busy || !state || state.volume >= 1}
                onPress={() => {
                  void run(() =>
                    setCoPilotVolume(Math.min(1, state!.volume + 0.1)),
                  );
                }}
              />
            </View>
            <DriverButton
              title="Test voice"
              secondary
              disabled={busy || !state || state.muted || state.volume === 0}
              onPress={() => {
                void run(testCoPilotVoice);
              }}
            />
            <Text style={{ color: p.muted }}>
              Volume adjusts CoPilot’s device audio stream. Spoken turns require
              active CoPilot guidance.
            </Text>
            {!!error && (
              <Text accessibilityRole="alert" style={{ color: p.danger }}>
                {error}
              </Text>
            )}
            <DriverButton
              title="Close"
              secondary
              onPress={() => setOpen(false)}
            />
          </View>
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
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    padding: 20,
  },
  panel: { padding: 20, borderRadius: 18, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
