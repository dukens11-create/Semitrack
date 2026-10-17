import React, { useContext } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  type TextInputProps,
} from 'react-native';
import { DriverIcon, type DriverIconName } from './DriverIcon';
import { DriverAppearanceContext } from '../features/settings/DriverPreferences';
// Ported from lib/theme/semitrack_theme.dart and lib/widgets/semitrack_ui.dart.
export const driverColors = {
  ink: '#101820',
  navy: '#172433',
  orange: '#FF6B2C',
  green: '#14966F',
  blue: '#2374E1',
};
export function useDriverPalette() {
  const mode = useContext(DriverAppearanceContext);
  const scheme = useColorScheme();
  const dark = mode === 'night' || (mode === 'system' && scheme === 'dark');
  return {
    dark,
    canvas: dark ? '#0C131B' : '#F3F5F7',
    card: dark ? '#17212C' : '#FFFFFF',
    text: dark ? '#FFFFFF' : '#101820',
    muted: dark ? '#B9C6D3' : '#637080',
    border: dark ? '#2D3742' : '#E4E8ED',
    input: dark ? '#202C38' : '#EEF1F4',
  };
}
export function DriverPage({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <KeyboardAvoidingView
      style={ds.grow}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: p.canvas }}
        contentContainerStyle={ds.page}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function DriverTitle({
  children,
  small = false,
}: React.PropsWithChildren<{ small?: boolean }>) {
  const p = useDriverPalette();
  return (
    <Text
      accessibilityRole="header"
      style={[small ? ds.section : ds.title, { color: p.text }]}
    >
      {children}
    </Text>
  );
}
export function DriverCopy({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return <Text style={[ds.copy, { color: p.muted }]}>{children}</Text>;
}
export function DriverCard({
  children,
  onPress,
}: React.PropsWithChildren<{ onPress?: () => void }>) {
  const p = useDriverPalette();
  const style = [ds.card, { backgroundColor: p.card, borderColor: p.border }];
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={style}>
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}
export function DriverButton({
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
  const p = useDriverPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        ds.button,
        { backgroundColor: secondary ? p.input : driverColors.orange },
        disabled && ds.disabled,
      ]}
    >
      <Text
        style={[ds.buttonText, secondary ? { color: p.text } : ds.whiteText]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function DriverTile({
  icon,
  title,
  caption,
  onPress,
  disabled = false,
}: {
  icon: DriverIconName;
  title: string;
  caption: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const p = useDriverPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[ds.tile, { backgroundColor: p.card, borderColor: p.border }]}
    >
      <View style={ds.iconBox}>
        <DriverIcon name={icon} />
      </View>
      <View style={ds.grow}>
        <Text style={[ds.tileTitle, { color: p.text }]}>{title}</Text>
        <DriverCopy>{caption}</DriverCopy>
      </View>
      {!disabled && <DriverIcon name="chevron_right_rounded" color={p.muted} />}
    </Pressable>
  );
}
export function DriverEmpty({
  icon,
  title,
  message,
}: {
  icon: DriverIconName;
  title: string;
  message: string;
}) {
  return (
    <DriverCard>
      <View style={ds.empty}>
        <View style={ds.emptyIcon}>
          <DriverIcon name={icon} size={30} />
        </View>
        <DriverTitle small>{title}</DriverTitle>
        <DriverCopy>{message}</DriverCopy>
      </View>
    </DriverCard>
  );
}
export const ds = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: { fontWeight: '700', fontSize: 14 },
  fieldInput: {
    minHeight: 50,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
  },
  page: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
    flexGrow: 1,
  },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.7 },
  section: { fontSize: 21, fontWeight: '800', letterSpacing: -0.25 },
  copy: { fontSize: 14, lineHeight: 20 },
  card: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    boxShadow: '0 7px 18px #1018200D',
  },
  button: {
    minHeight: 52,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteText: { color: 'white' },
  buttonText: { fontSize: 16, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  tile: {
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tileTitle: { fontWeight: '900', fontSize: 15 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#FF6B2C1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF6B2C1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

export function DriverField({
  label,
  style,
  ...props
}: TextInputProps & { label: string }) {
  const p = useDriverPalette();
  return (
    <View style={ds.field}>
      <Text style={[ds.fieldLabel, { color: p.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        {...props}
        style={[
          ds.fieldInput,
          {
            borderColor: p.border,
            backgroundColor: p.input,
            color: p.text,
          },
          style,
        ]}
      />
    </View>
  );
}
