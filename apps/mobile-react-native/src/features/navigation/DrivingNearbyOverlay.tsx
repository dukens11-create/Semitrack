import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { DriverIcon } from '../../components/DriverIcon';
import { useDriverPalette } from '../../components/DriverUI';
import { poiIcon } from '../poi/PoiPresentation';
import type { Poi, PoiService } from '../poi/PoiService';
import type { LocationFix } from '../../services/location/LocationService';
import { freshFix } from './navigationPresentation';
import { stopDistanceMeters } from '../../models/stopCoverage';
import {
  drivingCategories,
  drivingHeading,
  providerExit,
  visibleNearby,
  type NearbyCache,
} from './drivingNearby';

export function DrivingNearbyOverlay({
  service,
  fix,
  active,
  availableHeight,
  onSelect,
}: {
  service: Pick<PoiService, 'nearby'>;
  fix: LocationFix | null;
  active: boolean;
  availableHeight: number;
  onSelect?: (poi: Poi) => void;
}) {
  const p = useDriverPalette();
  const [cache, setCache] = useState<NearbyCache>({});
  const [now, setNow] = useState(Date.now);
  const [collapsed, setCollapsed] = useState(false);
  const latest = useRef(fix);
  latest.current = fix;
  useEffect(() => {
    setCache({});
    if (!active) return;
    let current = true,
      pending = false;
    let lastAt = 0;
    let lastFix: LocationFix | null = null;
    let controller: AbortController | undefined;
    const refresh = async () => {
      const time = Date.now();
      setNow(time);
      const currentFix = latest.current;
      if (
        pending ||
        AppState.currentState !== 'active' ||
        !freshFix(currentFix, time) ||
        !currentFix
      )
        return;
      const moved = lastFix
        ? stopDistanceMeters(
            { lat: lastFix.latitude, lng: lastFix.longitude },
            { lat: currentFix.latitude, lng: currentFix.longitude },
          )
        : Infinity;
      if (time - lastAt < 15000 || (time - lastAt < 60000 && moved < 804.672))
        return;
      pending = true;
      lastAt = time;
      lastFix = currentFix;
      controller = new AbortController();
      const signal = controller.signal;
      try {
        for (const category of drivingCategories) {
          if (!current || signal.aborted) break;
          try {
            const items = await service.nearby(
              category,
              { lat: currentFix.latitude, lng: currentFix.longitude },
              signal,
            );
            if (current && !signal.aborted)
              setCache(previous => ({
                ...previous,
                [category]: {
                  items,
                  observedAt: Date.now(),
                  latitude: currentFix.latitude,
                  longitude: currentFix.longitude,
                },
              }));
          } catch {
            if (current && !signal.aborted)
              setCache(previous => ({
                ...previous,
                [category]: {
                  items: [],
                  failed: true,
                  observedAt: Date.now(),
                  latitude: currentFix.latitude,
                  longitude: currentFix.longitude,
                },
              }));
          }
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    const lifecycle = AppState.addEventListener('change', state => {
      controller?.abort();
      setCache({});
      lastAt = 0;
      lastFix = null;
      if (state === 'active') void refresh();
    });
    return () => {
      current = false;
      controller?.abort();
      clearInterval(timer);
      lifecycle.remove();
    };
  }, [active, service]);
  if (!active) return null;
  const heading = drivingHeading(fix, now);
  const rows = visibleNearby(cache, fix, now);
  const compact = availableHeight < 290;
  const minimized = collapsed || availableHeight < 158;
  return (
    <View
      testID="driving-nearby-overlay"
      style={[
        styles.panel,
        compact ? styles.wide : styles.narrow,
        { borderColor: p.border },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          collapsed
            ? 'Expand nearby driving places'
            : 'Collapse nearby driving places'
        }
        accessibilityState={{ expanded: !minimized }}
        onPress={() => setCollapsed(value => !value)}
        style={[styles.header, { backgroundColor: p.card }]}
      >
        <View
          accessibilityLabel={
            heading
              ? `Travel heading ${heading.label}, ${Math.round(
                  heading.degrees,
                )} degrees`
              : 'Travel heading unavailable'
          }
          style={[styles.compass, { borderColor: p.border }]}
        >
          <Text style={styles.north}>N</Text>
          <Text
            style={[
              styles.needle,
              {
                color: p.actionText,
                transform: [{ rotate: `${heading?.degrees ?? 0}deg` }],
              },
            ]}
          >
            {heading ? '↑' : '·'}
          </Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.heading, { color: p.text }]}>
            {heading?.label ?? 'Nearby'}
          </Text>
          <Text style={[styles.caption, { color: p.muted }]}>
            Straight-line mi
          </Text>
        </View>
        <Text style={{ color: p.muted }}>{minimized ? '+' : '−'}</Text>
      </Pressable>
      {!minimized && (
        <View style={compact ? styles.grid : undefined}>
          {rows.map(row => {
            const label =
              row.category === 'truck_stop'
                ? `Truck stop ${row.slot + 1}`
                : row.category === 'weigh_station'
                ? 'Weigh station'
                : 'Rest area';
            const exit = providerExit(row.poi);
            const exits = row.category !== 'weigh_station';
            return (
              <Pressable
                key={row.category + row.slot}
                disabled={!row.poi || !onSelect}
                onPress={() => {
                  if (row.poi) onSelect?.(row.poi);
                }}
                accessibilityRole={row.poi && onSelect ? 'button' : undefined}
                accessibilityLabel={`${label}: ${row.poi?.name ?? row.status}${
                  row.miles === undefined
                    ? ''
                    : `, ${row.miles.toFixed(1)} miles straight-line`
                }${
                  exits ? `, ${exit ? 'Exit ' + exit : 'exit unavailable'}` : ''
                }`}
                style={[
                  styles.row,
                  compact && styles.gridCell,
                  { backgroundColor: p.card, borderColor: p.border },
                ]}
              >
                <DriverIcon
                  name={poiIcon(row.category)}
                  size={18}
                  color={
                    row.category === 'weigh_station' ? '#008F7D' : p.actionText
                  }
                />
                <View style={styles.copy}>
                  <Text
                    style={[styles.label, { color: p.muted }]}
                    numberOfLines={1}
                  >
                    {row.category === 'truck_stop'
                      ? `Truck ${row.slot + 1}`
                      : label}
                  </Text>
                  <Text
                    style={[styles.distance, { color: p.text }]}
                    numberOfLines={1}
                  >
                    {row.miles === undefined
                      ? '—'
                      : `${row.miles.toFixed(1)} mi`}
                    {exits && exit ? ` · Exit ${exit}` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 6 },
  narrow: { width: 112 },
  wide: { width: 230, maxWidth: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    minHeight: 44,
    borderRadius: 12,
  },
  headerCopy: { flex: 1 },
  heading: { fontSize: 12, fontWeight: '800' },
  caption: { fontSize: 9 },
  compass: {
    width: 30,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  north: { fontSize: 8, color: '#E45438', lineHeight: 10, fontWeight: '800' },
  needle: { fontSize: 19, lineHeight: 20, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridCell: { width: 112 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 48,
    marginBottom: 6,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1 },
  label: { fontSize: 10, lineHeight: 12 },
  name: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  distance: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
});
