import React, { useSyncExternalStore } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AlertButton,
  type AlertOptions,
} from 'react-native';
import { useDriverPalette } from './DriverUI';
type Prompt = {
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};
let queue: Prompt[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => queue[0];
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ) {
    queue = [
      ...queue,
      {
        title,
        message,
        buttons: buttons?.length ? buttons : [{ text: 'OK' }],
        options,
      },
    ];
    emit();
  },
};
export function ThemedAlertHost() {
  const prompt = useSyncExternalStore(subscribe, snapshot, snapshot);
  const p = useDriverPalette();
  if (!prompt) return null;
  function finish(action?: () => void) {
    queue = queue.slice(1);
    emit();
    action?.();
  }
  function cancel() {
    if (!prompt) return;
    const button = prompt.buttons.find(item => item.style === 'cancel');
    if (button) finish(button.onPress);
    else if (prompt.options?.cancelable) finish(prompt.options.onDismiss);
  }
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={cancel}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.scrim}>
        <ScrollView
          contentContainerStyle={styles.center}
          keyboardShouldPersistTaps="handled"
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.dialog,
              { backgroundColor: p.card, borderColor: p.border },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: p.text }]}
            >
              {prompt.title}
            </Text>
            {!!prompt.message && (
              <Text style={[styles.message, { color: p.muted }]}>
                {prompt.message}
              </Text>
            )}
            {prompt.buttons.map((button, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={button.text ?? 'OK'}
                onPress={() => finish(button.onPress)}
                style={[styles.button, { backgroundColor: p.input }]}
              >
                <Text
                  style={[
                    styles.label,
                    {
                      color: button.style === 'destructive' ? p.danger : p.text,
                    },
                  ]}
                >
                  {button.text ?? 'OK'}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center' },
  center: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  dialog: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: 20,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
  },
  title: { fontSize: 21, fontWeight: '800' },
  message: { fontSize: 16, lineHeight: 23 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    padding: 14,
    justifyContent: 'center',
  },
  label: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
