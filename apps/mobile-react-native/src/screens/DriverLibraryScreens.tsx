import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Services } from '../app/services';
import { routeEstimate } from '../features/routing/RoutePreview';
import { useStore } from '../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverEmpty,
  DriverPage,
  DriverTitle,
  useDriverPalette,
} from '../components/DriverUI';
function Filters({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const p = useDriverPalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filters}
    >
      {items.map(item => (
        <Pressable
          key={item}
          accessibilityRole="tab"
          accessibilityState={{ selected: item === value }}
          onPress={() => onChange(item)}
          style={[
            styles.chip,
            {
              backgroundColor: p.card,
              borderColor: p.border,
            },
            item === value && styles.selectedChip,
          ]}
        >
          <Text style={[styles.chipText, { color: p.text }]}>{item}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function TripsScreen({
  services,
  onMap,
}: {
  services: Services;
  onMap: () => void;
}) {
  const [filter, setFilter] = useState('Planned');
  const routes = useStore(services.routes);
  const { settings } = useStore(services.settings);
  const estimate = routes.route
    ? routeEstimate(routes.route, settings?.units === 'metric')
    : null;
  return (
    <DriverPage>
      <DriverTitle>Trips</DriverTitle>
      <DriverCopy>Plan, review, and repeat your truck-safe routes.</DriverCopy>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Start a new haul</Text>
        <Text style={styles.heroCopy}>
          Add a destination and optional waypoints on the map.
        </Text>
        <DriverButton title="Plan" onPress={onMap} />
      </View>
      <Filters
        items={['Planned', 'Recent', 'Saved']}
        value={filter}
        onChange={setFilter}
      />
      {filter === 'Planned' && routes.route ? (
        <DriverCard>
          <DriverTitle small>
            {routes.plan?.destination.name || 'Current truck route'}
          </DriverTitle>
          <DriverCopy>
            {estimate?.distance} · {estimate?.duration} · Route estimate
          </DriverCopy>
          <DriverCopy>
            This session only. Trip history is not yet available.
          </DriverCopy>
          <DriverButton title="Review route" onPress={onMap} />
        </DriverCard>
      ) : (
        <DriverEmpty
          icon={
            filter === 'Saved'
              ? 'bookmark_border_rounded'
              : filter === 'Recent'
              ? 'history_rounded'
              : 'route_rounded'
          }
          title={
            filter === 'Planned'
              ? 'No planned trips'
              : filter + ' trips unavailable'
          }
          message={
            filter === 'Planned'
              ? 'Plan a route on the map. Saved trip history is not available in this version.'
              : 'Trip history and saved routes are not available in this version.'
          }
        />
      )}
      <DriverButton title="Plan truck route" onPress={onMap} />
    </DriverPage>
  );
}
export function DocumentsScreen() {
  const [category, setCategory] = useState('All');
  return (
    <DriverPage>
      <DriverTitle>Documents</DriverTitle>
      <DriverCopy>
        Rate confirmations, bills of lading, PODs, permits, and notes.
      </DriverCopy>
      <Filters
        items={['All', 'Rate con', 'BOL', 'POD', 'Permit', 'Note']}
        value={category}
        onChange={setCategory}
      />
      <DriverEmpty
        icon="folder_open_rounded"
        title="Your road paperwork, organized"
        message="Document storage is not available in this React Native version. Existing Flutter records have not been imported."
      />
      <DriverButton
        title="Add document record — unavailable"
        disabled
        onPress={() => {}}
      />
    </DriverPage>
  );
}
const styles = StyleSheet.create({
  chipText: { fontWeight: '700' },
  selectedChip: { backgroundColor: '#FF6B2C29', borderColor: '#FF6B2C' },
  filters: { gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  hero: { backgroundColor: '#172433', borderRadius: 20, padding: 16, gap: 10 },
  heroTitle: { color: 'white', fontSize: 20, fontWeight: '900' },
  heroCopy: { color: '#FFFFFFB3', lineHeight: 20 },
});
