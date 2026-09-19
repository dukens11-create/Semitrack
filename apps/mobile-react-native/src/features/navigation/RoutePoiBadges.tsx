import { useDriverPalette } from '../../components/DriverUI';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PoiArtwork } from '../poi/PoiPresentation';
import { aheadPois, type Poi } from '../poi/PoiService';
import { currentObservation } from './providerEvidence';
import { distanceText, freshFix } from './navigationPresentation';
import type { LocationFix } from '../../services/location/LocationService';
/** No sample businesses, inferred exits or unsourced live distances appear on the map. */
export function RoutePoiBadges({
  pois,
  fix,
  metric,
  onSelect,
}: {
  pois: Poi[];
  fix: LocationFix | null;
  metric: boolean;
  onSelect: (poi: Poi) => void;
}) {
  const p = useDriverPalette();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pois.length) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [pois]);
  const items = freshFix(fix)
    ? aheadPois(pois)
        .filter(poi => currentObservation(poi, 15000))
        .slice(0, 2)
    : [];
  if (!items.length) return null;
  return (
    <View style={styles.stack}>
      {items.map(poi => (
        <Pressable
          key={poi.id}
          accessibilityRole="button"
          accessibilityLabel={'POI ahead: ' + poi.name}
          onPress={() => onSelect(poi)}
          style={[
            styles.badge,
            { backgroundColor: p.card, borderColor: p.border },
          ]}
        >
          <PoiArtwork poi={poi} />
          <View style={styles.copy}>
            <Text style={[styles.name, { color: p.muted }]} numberOfLines={1}>
              {poi.name}
            </Text>
            <Text style={[styles.distance, { color: p.text }]}>
              {distanceText(poi.routeDistanceAheadMeters!, metric)}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { alignItems: 'flex-start', gap: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '72%',
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#627B70',
    backgroundColor: '#161B1DF5',
    padding: 6,
    elevation: 4,
  },
  copy: { flexShrink: 1, paddingRight: 6 },
  name: { color: '#BBDCCD', fontSize: 12, fontWeight: '700' },
  distance: { color: 'white', fontSize: 20, fontWeight: '900' },
});
