import { CoPilotDeviceSetup } from './CoPilotDeviceSetup';
import { useDriverPalette } from './DriverUI';
import React, { useState } from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  embeddedSession,
  embeddedStatus,
} from '../services/copilot/EmbeddedSession';
import { useSyncExternalStore } from 'react';

/** Non-blocking status; backend setup/authentication remains independent. */
export function CopilotStatus() {
  const p = useDriverPalette();
  const state = useSyncExternalStore(
    embeddedSession.subscribe,
    embeddedSession.getSnapshot,
  );
  const [details, setDetails] = useState(false);
  const label = embeddedStatus(state);
  const message =
    'Truck-route preview uses Trimble. Live guidance remains disabled until native truck-profile, route coverage and device verification pass.';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + '. View CoPilot status'}
        onPress={() => setDetails(true)}
        style={[styles.status, { backgroundColor: p.canvas }]}
      >
        <View style={styles.dot} />
        <Text numberOfLines={1} style={[styles.text, { color: p.muted }]}>
          {label}
        </Text>
        <Text
          style={[
            styles.details,
            p.dark ? styles.nightAction : styles.dayAction,
          ]}
        >
          Details
        </Text>
      </Pressable>
      <Modal
        visible={details}
        transparent
        animationType="fade"
        onRequestClose={() => setDetails(false)}
      >
        <KeyboardAvoidingView
          style={styles.scrim}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[styles.card, { backgroundColor: p.card }]}
            accessibilityViewIsModal
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={[styles.title, { color: p.text }]}>
                CoPilot navigation
              </Text>
              <Text style={[styles.message, { color: p.muted }]}>
                {message}
              </Text>
              <CoPilotDeviceSetup />
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close CoPilot status"
              onPress={() => setDetails(false)}
              style={styles.close}
            >
              <Text
                style={[
                  styles.closeText,
                  p.dark ? styles.nightAction : styles.dayAction,
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  nightAction: { color: '#F0A45A' },
  dayAction: { color: '#9F341E' },
  status: {
    minHeight: 32,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#0C131B',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F0A45A' },
  text: { color: '#C5CFD8', fontSize: 11, flexShrink: 1 },
  details: { color: '#F0A45A', fontSize: 11, fontWeight: '700' },
  scrim: {
    flex: 1,
    padding: 28,
    justifyContent: 'center',
    backgroundColor: '#00000088',
  },
  card: {
    maxHeight: '90%',
    borderRadius: 20,
    backgroundColor: '#172534',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { padding: 24, gap: 16 },
  title: { color: 'white', fontSize: 20, fontWeight: '700' },
  message: { color: '#C5CFD8', fontSize: 15, lineHeight: 22 },
  close: { alignSelf: 'flex-end', padding: 12 },
  closeText: { color: '#FF8A50', fontSize: 16, fontWeight: '700' },
  warning: { padding: 16, backgroundColor: '#8B0000' },
  warningText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
