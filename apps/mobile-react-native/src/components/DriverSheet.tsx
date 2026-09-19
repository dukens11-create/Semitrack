import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DriverIcon } from './DriverIcon';
import { useDriverPalette } from './DriverUI';
export function DriverSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const p = useDriverPalette();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: p.card }]}
          >
            <View style={[styles.handle, { backgroundColor: p.border }]} />
            <View style={styles.header}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: p.text }]}
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={'Close ' + title}
                onPress={onClose}
                style={styles.close}
              >
                <DriverIcon name="close_rounded" color={p.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#10182080',
    justifyContent: 'flex-end',
  },
  keyboard: { height: '91%' },
  sheet: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  title: { flex: 1, fontSize: 19, fontWeight: '900' },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, gap: 16, paddingBottom: 28 },
});
