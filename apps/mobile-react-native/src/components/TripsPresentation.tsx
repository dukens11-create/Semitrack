import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DriverIcon, type DriverIconName } from './DriverIcon';
import { DriverCopy, useDriverPalette } from './DriverUI';

export function TripAction({
  title,
  label,
  onPress,
  disabled = false,
  icon,
}: {
  title: string;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: DriverIconName;
}) {
  const p = useDriverPalette();
  const actionColor = p.dark ? '#FFAB80' : '#A63D0B';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[ts.action, { backgroundColor: p.input }, disabled && ts.disabled]}
    >
      {icon && <DriverIcon name={icon} color={actionColor} size={22} />}
      <Text style={[ts.actionText, { color: actionColor }]}>
        {label ?? title}
      </Text>
    </Pressable>
  );
}

export function TripFilters({
  value,
  onChange,
}: {
  value: 'Recent' | 'Saved' | 'Planned';
  onChange: (value: 'Recent' | 'Saved' | 'Planned') => void;
}) {
  const p = useDriverPalette();
  return (
    <View
      style={[ts.filters, { backgroundColor: p.input, borderColor: p.border }]}
    >
      {(['Recent', 'Saved', 'Planned'] as const).map(label => (
        <Pressable
          key={label}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: value === label }}
          onPress={() => onChange(label)}
          style={[ts.filter, value === label && ts.selected]}
        >
          <Text
            style={[
              ts.filterText,
              { color: p.text },
              value === label && ts.selectedText,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function TripStatus({ status }: { status: string }) {
  const p = useDriverPalette();
  const planned = status === 'PLANNED' || status === 'ASSIGNED';
  // The current API exposes driver reports, not verified navigation history.
  const label = ['PLANNED', 'ASSIGNED', 'CANCELLED'].includes(status)
    ? status
    : 'TRIP RECORD';
  const backgroundColor = planned ? (p.dark ? '#43331A' : '#FFF1DB') : p.input;
  const color = planned ? (p.dark ? '#FFD083' : '#855000') : p.text;
  return (
    <View style={[ts.status, { backgroundColor }]}>
      <Text style={[ts.statusText, { color }]}>{label}</Text>
    </View>
  );
}

export function TripQuickActions({
  onPlan,
  onSaved,
}: {
  onPlan: () => void;
  onSaved: () => void;
}) {
  const p = useDriverPalette();
  const blue = p.dark ? '#84BEFF' : '#0969B6';
  return (
    <View style={ts.section}>
      <Text
        accessibilityRole="header"
        style={[ts.sectionTitle, { color: p.text }]}
      >
        Quick actions
      </Text>
      <View style={ts.quickRow}>
        {(
          [
            {
              title: 'Plan a truck route',
              copy: 'Build a new route',
              icon: 'map_outlined',
              action: onPlan,
            },
            {
              title: 'Saved trips',
              copy: 'View your saved plans',
              icon: 'bookmark_border_rounded',
              action: onSaved,
            },
          ] as const
        ).map(item => (
          <Pressable
            key={item.title}
            accessibilityRole="button"
            accessibilityLabel={
              item.title === 'Saved trips'
                ? 'View saved trips'
                : 'Build a new route'
            }
            onPress={item.action}
            style={[
              ts.quickCard,
              { backgroundColor: p.card, borderColor: p.border },
            ]}
          >
            <DriverIcon name={item.icon} size={30} color={blue} />
            <View style={ts.quickText}>
              <Text style={[ts.quickTitle, { color: p.text }]}>
                {item.title}
              </Text>
              <Text style={[ts.quickCopy, { color: p.muted }]}>
                {item.copy}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={[ts.tip, { backgroundColor: p.input }]}>
        <DriverIcon name="bookmark_border_rounded" size={30} color={blue} />
        <View style={ts.flex}>
          <Text style={[ts.quickTitle, { color: p.text }]}>Tip</Text>
          <Text style={[ts.quickCopy, { color: p.muted }]}>
            Save your planned routes for easy access on the road.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function TripIllustration() {
  const p = useDriverPalette();
  return (
    <View style={[ts.illustration, { backgroundColor: p.input }]}>
      <DriverIcon
        name="route_rounded"
        size={46}
        color={p.dark ? '#79BAF4' : '#286AA2'}
      />
      <DriverIcon
        name="local_shipping_rounded"
        size={60}
        color={p.dark ? '#C0D5EB' : '#526B84'}
      />
    </View>
  );
}

export function TripTruck({
  truck,
}: {
  truck?: {
    name?: string;
    heightFt?: number;
    weightLbs?: number;
    axleCount?: number;
  } | null;
}) {
  const p = useDriverPalette();
  if (!truck) return null;
  const values = [
    truck.name,
    truck.heightFt ? `${truck.heightFt} ft H` : null,
    truck.weightLbs ? `${truck.weightLbs.toLocaleString('en-US')} lb` : null,
    truck.axleCount ? `${truck.axleCount} axles` : null,
  ].filter(Boolean);
  if (!values.length) return null;
  return (
    <View style={ts.row}>
      <DriverIcon name="local_shipping_rounded" size={22} color={p.muted} />
      <View style={ts.flex}>
        <DriverCopy>{values.join(' · ')}</DriverCopy>
      </View>
    </View>
  );
}

export const ts = StyleSheet.create({
  page: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 16,
    flexGrow: 1,
  },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 18, fontWeight: '800', lineHeight: 25 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
  },
  action: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { fontWeight: '700', fontSize: 15, flexShrink: 1 },
  filters: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    borderRadius: 26,
  },
  filter: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  selected: { backgroundColor: '#FF6B2C' },
  selectedText: { color: '#172433' },
  disabled: { opacity: 0.5 },
  filterText: { fontSize: 15, fontWeight: '700' },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: { fontSize: 12, fontWeight: '800' },
  illustration: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 22,
    borderRadius: 28,
    marginTop: 8,
  },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  centered: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 300,
  },
  section: { gap: 10 },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  quickText: { flex: 1, minWidth: 90, gap: 4 },
  quickTitle: { fontSize: 16, fontWeight: '700' },
  quickCopy: { fontSize: 14, lineHeight: 21 },
  tip: {
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
  },
});
