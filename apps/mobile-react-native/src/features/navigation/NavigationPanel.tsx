import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDriverPalette } from '../../components/DriverUI';
export function NavigationPanel({
  header,
  footer,
  onClose,
  children,
}: React.PropsWithChildren<{
  header: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}>) {
  const p = useDriverPalette();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.page, { backgroundColor: p.canvas }]}>
        <View
          accessibilityViewIsModal
          style={[styles.page, { backgroundColor: p.canvas }]}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.header, { backgroundColor: p.card }]}>
              <Text style={[styles.eyebrow, { color: p.actionText }]}>
                NEXT MANEUVER
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Navigation Controls"
                onPress={onClose}
                style={styles.close}
              >
                <Text style={[styles.closeText, { color: p.actionText }]}>
                  ⌄
                </Text>
              </Pressable>
            </View>
            {header}
            <View style={styles.body}>{children}</View>
          </ScrollView>
          <View
            style={[
              styles.footer,
              { backgroundColor: p.card, borderColor: p.border },
            ]}
          >
            {footer}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
export function NavigationAction({
  title,
  label = title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  label?: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const p = useDriverPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        secondary && styles.secondary,
        secondary && { backgroundColor: p.input },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          secondary && styles.secondaryText,
          secondary && { color: p.text },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#06131D' },
  scroll: { paddingBottom: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#0B202D',
  },
  eyebrow: {
    color: '#FF9877',
    letterSpacing: 1.7,
    fontSize: 13,
    fontWeight: '900',
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: '#FF9877', fontSize: 30 },
  body: { padding: 16, gap: 14 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#233E4D',
    backgroundColor: '#071822',
  },
  action: {
    flexGrow: 1,
    flexBasis: 130,
    minHeight: 56,
    padding: 14,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF6425',
  },
  secondary: {
    backgroundColor: '#071822',
    borderWidth: 1,
    borderColor: '#92564A',
    flexGrow: 0,
    flexBasis: 108,
  },
  actionText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  secondaryText: { color: '#FFA18D' },
  disabled: { opacity: 0.45 },
});
