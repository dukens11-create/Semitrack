import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import { DriverIcon } from '../components/DriverIcon';
import {
  DriverButton,
  DriverCopy,
  DriverPage,
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
  const colors = p.dark ? homeIconColors.night : homeIconColors.day;
  const activeTruck = trucks.selected;
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
          Plan around truck restrictions, stops, and road conditions.
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
            {
              icon: 'route_rounded',
              label: 'Trips',
              action: onTrips,
              color: colors.trips,
            },
            {
              icon: 'description',
              label: 'Documents',
              action: onDocs,
              color: colors.documents,
            },
            {
              icon: 'local_shipping_rounded',
              label: 'My truck',
              action: onTrucks,
              color: driverColors.orange,
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
            <DriverIcon name={item.icon} size={28} color={item.color} />
            <Text style={[styles.shortcutText, { color: p.text }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View>
        <DriverTitle small>Truck-safe routing</DriverTitle>
        <DriverCopy>
          Uses your truck profile and verified provider data.
        </DriverCopy>
      </View>
      <View
        style={[
          styles.safetyCard,
          { backgroundColor: p.card, borderColor: p.border },
        ]}
      >
        {(
          [
            {
              icon: 'height_rounded',
              title: 'Clearance and size restrictions',
            },
            {
              icon: 'scale_rounded',
              title: 'Weight, axle and restricted roads',
            },
            {
              icon: 'warning_amber_rounded',
              title: 'Road conditions and alerts',
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
            <DriverIcon name={item.icon} color={colors.safety} size={22} />
            <View style={ds.grow}>
              <Text style={[styles.safetyText, { color: p.text }]}>
                {item.title}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View>
        <DriverTitle small>Before departure</DriverTitle>
        <DriverCopy>Confirm your active truck before routing.</DriverCopy>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Review truck profile"
        onPress={onTrucks}
        style={[
          styles.departureCard,
          { backgroundColor: p.card, borderColor: p.border },
        ]}
      >
        <View style={ds.row}>
          <View style={styles.truckIcon}>
            <DriverIcon
              name="local_shipping_rounded"
              color={driverColors.orange}
              size={28}
            />
          </View>
          <View style={styles.truckDetails}>
            <Text style={[styles.truckTitle, { color: p.text }]}>
              {activeTruck
                ? activeTruck.name + ' · Active'
                : 'No active truck profile'}
            </Text>
            {activeTruck ? (
              <>
                <DriverCopy>
                  {activeTruck.heightFt} ft H · {activeTruck.widthFt} ft W ·{' '}
                  {activeTruck.lengthFt} ft L
                </DriverCopy>
                <DriverCopy>
                  {activeTruck.weightLbs.toLocaleString('en-US')} lb ·{' '}
                  {activeTruck.axleCount} axles
                </DriverCopy>
              </>
            ) : (
              <DriverCopy>Add and verify your truck before routing.</DriverCopy>
            )}
          </View>
          <DriverIcon name="chevron_right_rounded" color={p.muted} />
        </View>
        <View style={styles.reviewAction}>
          <Text style={[styles.reviewText, { color: colors.review }]}>
            Review truck profile
          </Text>
          <DriverIcon
            name="chevron_right_rounded"
            color={colors.review}
            size={20}
          />
        </View>
      </Pressable>
    </DriverPage>
  );
}
const homeIconColors = {
  day: {
    trips: '#0969B6',
    documents: '#475569',
    safety: '#087F68',
    review: '#A63F0A',
  },
  night: {
    trips: '#7CC4FF',
    documents: '#C0CDDC',
    safety: '#6FE0B8',
    review: '#FFAD80',
  },
};
const styles = StyleSheet.create({
  safetyCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  departureCard: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 12 },
  truckIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FF6B2C1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckDetails: { flex: 1, minWidth: 0, gap: 2 },
  truckTitle: { fontSize: 16, fontWeight: '800' },
  reviewAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FF6B2C1F',
  },
  reviewText: { flex: 1, fontSize: 14, fontWeight: '800' },
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
  greeting: { gap: 4 },
  hero: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#172433',
    experimental_backgroundImage:
      'linear-gradient(135deg, #172433 0%, #263C52 100%)',
    gap: 12,
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
  heroCopy: { color: '#CDD9E5', lineHeight: 20 },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcut: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  shortcutText: { fontSize: 12, fontWeight: '900', textAlign: 'center' },
  safetyDivider: { borderTopWidth: 1 },
  safetyRow: {
    minHeight: 48,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  safetyText: { fontSize: 14, fontWeight: '800' },
});
