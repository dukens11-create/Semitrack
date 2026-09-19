import { useDriverPalette, DriverButton } from './DriverUI';
import { safeDriverError } from '../errors/driverErrors';
import React from 'react';
import {
  ActivityIndicator,
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
  const p = useDriverPalette();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: p.canvas }}
      contentContainerStyle={[styles.page, { backgroundColor: p.canvas }]}
    >
      {children}
    </ScrollView>
  );
}
export function Heading({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, { color: p.text }]}
    >
      {children}
    </Text>
  );
}
export function Copy({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return <Text style={[styles.copy, { color: p.text }]}>{children}</Text>;
}
export function Card({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <View
      style={[styles.card, { backgroundColor: p.card, borderColor: p.border }]}
    >
      {children}
    </View>
  );
}
export function ErrorText({ message }: { message?: string }) {
  const p = useDriverPalette();
  return message ? (
    <Text
      accessibilityRole="alert"
      style={[styles.error, p.dark ? styles.nightError : styles.error]}
    >
      {message}
    </Text>
  ) : null;
}
export const Button = DriverButton;
export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label: string }) {
  const p = useDriverPalette();
  return (
    <View>
      <Text style={[styles.label, { color: p.text }]}>{label}</Text>
      <TextInput
        keyboardAppearance={p.dark ? 'dark' : 'light'}
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        {...props}
        style={[
          styles.input,
          { color: p.text, backgroundColor: p.input, borderColor: p.border },
          style,
        ]}
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
  nightError: { color: '#FFB4AB' },
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
  error: { color: '#9C2020', fontSize: 14, lineHeight: 21 },
});
