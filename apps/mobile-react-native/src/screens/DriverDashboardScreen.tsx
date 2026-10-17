import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import { DriverIcon } from '../components/DriverIcon';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverPage,
  DriverTile,
  DriverTitle,
  driverColors,
  ds,
  useDriverPalette,
} from '../components/DriverUI';
export function DriverDashboardScreen({
  services,
  onMap,
  onTrips,
  onDocs,
  onMore,
  onTrucks,
}: {
  services: Services;
  onMap: () => void;
  onTrips: () => void;
  onDocs: () => void;
  onMore: () => void;
  onTrucks: () => void;
}) {
  const auth = useStore(services.auth),
    trucks = useStore(services.trucks);
  const p = useDriverPalette();
  const first = auth.user?.fullName.trim().split(/\s+/)[0] || 'Driver';
  return (
    <DriverPage>
      <View style={styles.header}>
        <Image
          source={require('../assets/original/images/semitrax_logo.png')}
          resizeMode="contain"
          accessibilityLabel="SemiTraX"
          style={styles.logo}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open More"
          onPress={onMore}
          style={styles.avatar}
        >
          <Text style={styles.initial}>{first.charAt(0).toUpperCase()}</Text>
        </Pressable>
      </View>
      <View style={styles.greeting}>
        <DriverTitle>Ready to roll, {first}?</DriverTitle>
        <DriverCopy>
          Plan around truck restrictions, stops, and live road conditions.
        </DriverCopy>
      </View>
      <View style={styles.hero}>
        <View style={styles.pill}>
          <DriverIcon name="verified_user_rounded" size={14} color="#6FE0B8" />
          <Text style={styles.pillText}>COMMERCIAL TRUCK MODE</Text>
        </View>
        <Text style={styles.heroTitle}>Where are you hauling?</Text>
        <Text style={styles.heroCopy}>
          Build a route using your active truck profile.
        </Text>
        <DriverButton title="Choose destination" onPress={onMap} />
      </View>
      <View>
        <DriverTitle small>Driver shortcuts</DriverTitle>
        <DriverCopy>Everything important stays one tap away</DriverCopy>
      </View>
      <View style={styles.shortcuts}>
        {(
          [
            { icon: 'route_rounded', label: 'Trips', action: onTrips },
            { icon: 'description', label: 'Documents', action: onDocs },
            {
              icon: 'local_shipping_rounded',
              label: 'My truck',
              action: onTrucks,
            },
          ] as const
        ).map(item => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={item.action}
            style={[
              styles.shortcut,
              { backgroundColor: p.card, borderColor: p.border },
            ]}
          >
            <DriverIcon name={item.icon} size={28} />
            <Text style={[styles.shortcutText, { color: p.text }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View>
        <DriverTitle small>Truck-safe by design</DriverTitle>
        <DriverCopy>
          SemiTraX never substitutes a passenger-car route
        </DriverCopy>
      </View>
      <DriverCard>
        {(
          [
            {
              icon: 'height_rounded',
              title: 'Clearance and size restrictions',
            },
            {
              icon: 'scale_rounded',
              title: 'Weight, axle, and prohibited roads',
            },
            {
              icon: 'warning_amber_rounded',
              title: 'Road alerts, grades, and live DOT data',
            },
          ] as const
        ).map((item, i) => (
          <View
            key={item.title}
            style={[
              styles.safetyRow,
              i > 0 && styles.safetyDivider,
              i > 0 && { borderColor: p.border },
            ]}
          >
            <DriverIcon name={item.icon} color={driverColors.green} size={22} />
            <View style={ds.grow}>
              <Text style={[styles.safetyText, { color: p.text }]}>
                {item.title}
              </Text>
            </View>
          </View>
        ))}
        <DriverCopy>
          Safety checks require a verified truck profile and provider data.
          Missing coverage is unknown; live navigation is not available.
        </DriverCopy>
      </DriverCard>
      <View>
        <DriverTitle small>Before departure</DriverTitle>
        <DriverCopy>Verify the details that control your route</DriverCopy>
      </View>
      <DriverTile
        icon="straighten_rounded"
        title="Truck dimensions and weight"
        caption={
          trucks.selected
            ? trucks.selected.name +
              ' · Review height, width, length, axles, trailer and HAZMAT'
            : 'No active truck · Enter and verify your vehicle facts'
        }
        onPress={onTrucks}
      />
    </DriverPage>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: { width: 82, height: 43 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF6B2C24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: '#FF6B2C', fontWeight: '900' },
  greeting: { marginTop: 12, gap: 6 },
  hero: {
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#172433',
    experimental_backgroundImage:
      'linear-gradient(135deg, #172433 0%, #263C52 100%)',
    gap: 18,
    boxShadow: '0 12px 24px #10182033',
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: '#6FE0B81F',
  },
  pillText: {
    color: '#6FE0B8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.25,
  },
  heroTitle: {
    color: 'white',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroCopy: { color: '#FFFFFFB3', lineHeight: 20, marginTop: -12 },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcut: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 15,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  shortcutText: { fontSize: 12, fontWeight: '900', textAlign: 'center' },
  safetyDivider: { borderTopWidth: 1, paddingTop: 12 },
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  safetyText: { fontSize: 14, fontWeight: '800' },
});
