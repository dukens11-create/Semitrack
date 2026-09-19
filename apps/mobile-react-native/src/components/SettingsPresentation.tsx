import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { DriverIcon, type DriverIconName } from './DriverIcon';
import { DriverField, useDriverPalette } from './DriverUI';

export function SettingsSurface({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <View
      style={[ss.surface, { backgroundColor: p.card, borderColor: p.border }]}
    >
      {children}
    </View>
  );
}

export function SettingsRow({
  title,
  icon,
  color,
  onPress,
  caption,
}: {
  title: string;
  icon: DriverIconName;
  color: 'blue' | 'teal' | 'orange' | 'purple' | 'slate';
  onPress: () => void;
  caption?: string;
}) {
  const p = useDriverPalette();
  const tones = {
    blue: p.dark ? '#8ABBFF' : '#2457B8',
    teal: p.dark ? '#72DEC8' : '#007A66',
    orange: p.dark ? '#FFBA7A' : '#A54800',
    purple: p.dark ? '#CCA9FF' : '#6C3AB5',
    slate: p.dark ? '#C0CDDC' : '#475569',
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={[ss.row, { borderColor: p.border }]}
    >
      <View style={[ss.tile, { backgroundColor: p.input }]}>
        <DriverIcon name={icon} color={tones[color]} size={23} />
      </View>
      <View style={ss.flex}>
        <Text style={[ss.rowTitle, { color: p.text }]}>{title}</Text>
        {caption && (
          <Text style={[ss.copy, { color: p.muted }]}>{caption}</Text>
        )}
      </View>
      <DriverIcon name="chevron_right_rounded" color={p.muted} />
    </Pressable>
  );
}
export function SettingChoices<T extends string>({
  label,
  value,
  items,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  items: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const p = useDriverPalette();
  return (
    <View style={ss.group}>
      <Text style={[ss.rowTitle, { color: p.text }]}>{label}</Text>
      <View style={[ss.choices, { backgroundColor: p.input }]}>
        {items.map(item => (
          <Pressable
            key={item.value}
            accessibilityRole="radio"
            accessibilityLabel={item.label}
            accessibilityState={{ checked: item.value === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(item.value)}
            style={[ss.choice, item.value === value && ss.selected]}
          >
            <Text
              style={[
                ss.choiceText,
                { color: p.text },
                item.value === value && ss.selectedText,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function SettingToggle({
  label,
  description,
  value,
  disabled,
  onChange,
  preference = false,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  preference?: boolean;
}) {
  const p = useDriverPalette();
  const track = preference ? (p.dark ? '#506D89' : '#66839E') : '#FF6B2C';
  return (
    <View style={ss.toggle}>
      <View style={ss.flex}>
        <Text style={[ss.rowTitle, { color: p.text }]}>{label}</Text>
        <Text style={[ss.copy, { color: p.muted }]}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: p.border, true: track }}
        thumbColor={p.toggleThumb}
        ios_backgroundColor={p.border}
      />
    </View>
  );
}
export function SettingsPasswordField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const p = useDriverPalette();
  return (
    <View style={ss.group}>
      <DriverField
        label={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={
          label === 'Current password' ? 'current-password' : 'new-password'
        }
        editable={!disabled}
        maxLength={128}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={(visible ? 'Hide ' : 'Show ') + label.toLowerCase()}
        disabled={disabled}
        onPress={() => setVisible(!visible)}
        style={ss.reveal}
      >
        <Text style={[ss.copy, { color: p.text }]}>
          {visible ? 'Hide' : 'Show'} password
        </Text>
      </Pressable>
    </View>
  );
}
export const ss = StyleSheet.create({
  surface: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  flex: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  hidden: { display: 'none' },
  group: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  copy: { fontSize: 13, lineHeight: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { minWidth: 48, minHeight: 48, justifyContent: 'center' },
  backText: { fontSize: 16, fontWeight: '700' },
  avatar: {
    height: 54,
    width: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 20, fontWeight: '800' },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 78,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 3,
    borderRadius: 18,
  },
  choice: {
    flex: 1,
    minWidth: 70,
    minHeight: 44,
    paddingHorizontal: 7,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 14, fontWeight: '700' },
  selected: { backgroundColor: '#FF6B2C' },
  selectedText: { color: '#172433' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
  },
  reveal: {
    minHeight: 44,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  signOut: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  signOutText: { fontSize: 16, fontWeight: '700' },
});
