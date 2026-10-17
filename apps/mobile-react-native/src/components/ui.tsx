import { safeDriverError } from '../errors/driverErrors';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
export const colors = {
  navy: '#172433',
  orange: '#FF6B2C',
  ink: '#101820',
  canvas: '#F3F5F7',
  muted: '#596777',
  border: '#CED5DE',
};
export function Page({ children }: React.PropsWithChildren) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      {children}
    </ScrollView>
  );
}
export function Heading({ children }: React.PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
export function Copy({ children }: React.PropsWithChildren) {
  return <Text style={styles.copy}>{children}</Text>;
}
export function Card({ children }: React.PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}
export function ErrorText({ message }: { message?: string }) {
  return message ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  ) : null;
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}
export function Busy() {
  return (
    <ActivityIndicator accessibilityLabel="Loading" color={colors.orange} />
  );
}
export function errorMessage(error: unknown) {
  return safeDriverError(error);
}
const styles = StyleSheet.create({
  page: { padding: 20, gap: 14, backgroundColor: colors.canvas, flexGrow: 1 },
  heading: { fontSize: 25, fontWeight: '800', color: colors.navy },
  copy: { fontSize: 15, lineHeight: 22, color: colors.ink },
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 12,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 14, color: colors.ink, marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    minHeight: 48,
    padding: 12,
    backgroundColor: 'white',
    color: colors.ink,
  },
  button: {
    minHeight: 48,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    borderRadius: 8,
    marginVertical: 4,
  },
  secondary: { backgroundColor: '#435468' },
  disabled: { opacity: 0.45 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 15 },
  error: { color: '#9C2020', fontSize: 14, lineHeight: 21 },
});
