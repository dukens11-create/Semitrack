import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { DriverIcon } from '../../components/DriverIcon';
import { useDriverPalette } from '../../components/DriverUI';
import { LaneGuidance } from './LaneGuidance';
import { routeDisplayProgress } from './routeDisplayProgress';
import type { TruckRoute } from '../../models/contracts';
import type { NavigationState } from '../../services/guidance/NavigationEngine';
import type { LocationFix } from '../../services/location/LocationService';
import { distanceText, navigationPresentation } from './navigationPresentation';
export function maneuverSymbol(action?: string) {
  if (!action) return '?';
  const value = action.toLowerCase().replace(/[_-]/g, ' ');
  if (/u ?turn/.test(value)) return '↶';
  if (/left/.test(value)) return '↰';
  if (/right/.test(value)) return '↱';
  if (/straight|continue|depart|arriv|destination/.test(value)) return '↑';
  return '?';
}
export function maneuverDistance(meters: number, metric: boolean) {
  return !metric && meters < 160.9344
    ? Math.round((meters * 3.28084) / 5) * 5 + ' ft'
    : distanceText(meters, metric);
}
export function NavigationHud({
  route,
  destination,
  state,
  fix,
  metric = false,
  placement = 'all',
  onMore,
  onReview,
}: {
  route: TruckRoute | null;
  destination?: string;
  state: NavigationState;
  fix: LocationFix | null;
  metric?: boolean;
  placement?: 'all' | 'maneuver' | 'dashboard' | 'panel';
  onMore?: () => void;
  onReview?: () => void;
}) {
  const palette = useDriverPalette();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!route) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [route]);
  const data = navigationPresentation(route, state, fix);
  if (!route || !data) return null;
  const g = data.guidance,
    preview = data.mode === 'preview',
    panel = placement === 'panel';
  const progress =
    g?.maneuverMeters !== undefined
      ? routeDisplayProgress(route, state.maneuverOffset)
      : null;
  const distance = preview
    ? distanceText(route.distanceMiles * 1609.344, metric)
    : data.remainingMeters === undefined
    ? '—'
    : distanceText(data.remainingMeters, metric);
  const duration = preview
    ? Math.ceil(route.durationSeconds / 60) + 'm'
    : data.remainingSeconds === undefined
    ? '—'
    : Math.ceil(data.remainingSeconds / 60) + 'm';
  const eta =
    !preview &&
    data.remainingSeconds !== undefined &&
    state.progressObservedAt !== undefined
      ? new Date(
          state.progressObservedAt + data.remainingSeconds * 1000,
        ).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : undefined;
  const speed =
    data.speedMps === undefined
      ? '--'
      : String(Math.round(data.speedMps * (metric ? 3.6 : 2.236936)));
  const limit =
    g?.speedLimitMph === undefined
      ? '--'
      : String(Math.round(g.speedLimitMph * (metric ? 1.609344 : 1)));
  const road = g?.currentRoad;
  const shield =
    /^(?:I[- ]|Interstate\s+)(\d+)\b/i.exec(g?.highway ?? road ?? '') ??
    /^(?:US[- ]|U\.S\.\s+)(\d+)\b/i.exec(g?.highway ?? road ?? '');
  const previewCard = (
    <View
      testID="route-preview-card"
      style={[
        styles.previewCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.previewIcon}>
        <DriverIcon name="route_rounded" size={23} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.previewEyebrow}>ROUTE PREVIEW</Text>
        <Text
          accessibilityLabel={'Destination: ' + (destination ?? 'Truck route')}
          style={[styles.previewDestination, { color: palette.text }]}
          numberOfLines={2}
        >
          {destination ?? 'Truck route'}
        </Text>
        <Text style={[styles.previewCaption, { color: palette.muted }]}>
          Trimble estimate · Guidance has not started
        </Text>
      </View>
    </View>
  );
  const maneuver = (
    <View
      style={[
        styles.maneuver,
        panel && styles.panelManeuver,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={[styles.symbolBox, panel && styles.orangeSymbol]}>
        <Text
          accessible={false}
          style={[styles.symbol, { color: palette.text }]}
        >
          {preview ? '◇' : maneuverSymbol(g?.action)}
        </Text>
      </View>
      <View style={styles.grow}>
        <Text
          style={[
            styles.instruction,
            panel && styles.panelInstruction,
            { color: palette.muted },
          ]}
        >
          {preview
            ? 'Route preview · Trimble estimate'
            : data.mode === 'paused'
            ? 'Navigation paused'
            : data.mode === 'rerouting'
            ? 'Rerouting — waiting for provider'
            : data.mode === 'arrived'
            ? 'Destination reached'
            : g?.instruction ?? 'Waiting for live guidance data'}
        </Text>
        {(g?.nextRoad || (destination && preview)) && (
          <Text
            style={[
              styles.roadTitle,
              panel && styles.panelRoad,
              { color: palette.text },
            ]}
            numberOfLines={2}
          >
            {g?.nextRoad ?? destination}
          </Text>
        )}
        {!panel && g?.maneuverMeters !== undefined && (
          <Text style={[styles.maneuverDistance, { color: palette.text }]}>
            {maneuverDistance(g.maneuverMeters, metric)}
          </Text>
        )}
        {g?.exit && <Text style={styles.exit}>EXIT {g.exit}</Text>}
        {g?.toward && (
          <Text
            style={[styles.toward, { color: palette.text }]}
            numberOfLines={2}
          >
            toward {g.toward}
          </Text>
        )}
        {preview && (
          <Text style={[styles.toward, { color: palette.text }]}>
            Guidance has not started
          </Text>
        )}
        {data.mode === 'arrived' && (
          <Text style={[styles.toward, { color: palette.text }]}>
            Arrival reported by the navigation provider.
          </Text>
        )}
      </View>
      {panel && g?.maneuverMeters !== undefined && (
        <View style={[styles.distancePill, { backgroundColor: palette.card }]}>
          <Text style={[styles.pillText, { color: palette.text }]}>
            {maneuverDistance(g.maneuverMeters, metric)}
          </Text>
        </View>
      )}
    </View>
  );
  const summary = (
    <View
      style={[
        styles.summary,
        { backgroundColor: palette.card, borderColor: palette.border },
        panel && styles.panelSummary,
        { backgroundColor: palette.card },
      ]}
    >
      {!panel && (
        <View style={styles.brand}>
          <Image
            source={require('../../assets/original/images/semitrax_logo.png')}
            resizeMode="contain"
            style={styles.brandImage}
          />
        </View>
      )}
      <Pressable
        disabled={!onReview}
        accessibilityRole={onReview ? 'button' : undefined}
        accessibilityLabel={onReview ? 'Review route and stops' : undefined}
        onPress={onReview}
        style={styles.summaryBody}
      >
        <Text
          style={[
            styles.totals,
            { color: palette.text },
            panel && styles.white,
            { color: palette.text },
          ]}
        >
          {distance} <Text style={styles.divider}>│</Text> {duration}
        </Text>
        <Text
          style={[
            styles.eta,
            { color: palette.muted },
            panel && styles.panelMuted,
            { color: palette.muted },
          ]}
        >
          {preview
            ? 'Planning estimate · Trimble'
            : eta
            ? eta + ' · arrival'
            : data.mode === 'arrived'
            ? 'Arrival confirmed by provider'
            : 'Live ETA unavailable'}
        </Text>
      </Pressable>
      {onMore && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Navigation Controls"
          onPress={onMore}
          style={[styles.more, { backgroundColor: palette.input }]}
        >
          <Text style={[styles.moreChevron, { color: palette.muted }]}>
            •••
          </Text>
          <Text style={[styles.moreText, { color: palette.text }]}>More</Text>
        </Pressable>
      )}
    </View>
  );
  return (
    <View testID="navigation-hud" style={styles.stack}>
      {placement !== 'dashboard' && (
        <>
          {preview && !panel ? previewCard : maneuver}
          {!panel && g?.subsequent && (
            <View style={[styles.then, { backgroundColor: palette.card }]}>
              <Text
                style={[styles.thenText, { color: palette.text }]}
                numberOfLines={2}
              >
                Then {g.subsequent}
              </Text>
            </View>
          )}
          <LaneGuidance lanes={g?.lanes} />
          {g?.junction && (
            <View
              testID="junction-guidance"
              style={[styles.then, { backgroundColor: palette.card }]}
            >
              <Text style={[styles.thenText, { color: palette.text }]}>
                {g.junction.label}: {g.junction.directions.join(' · ')}
              </Text>
            </View>
          )}
        </>
      )}
      {(placement === 'all' || placement === 'dashboard') && (
        <View style={styles.instruments}>
          <View
            style={[styles.speedCard, palette.dark && styles.nightSpeedCard]}
          >
            <View style={styles.limit}>
              <Text style={styles.limitNumber}>{limit}</Text>
              <Text style={styles.limitLabel}>LIMIT</Text>
            </View>
            <View style={styles.speed}>
              <Text style={styles.speedNumber}>{speed}</Text>
              <Text style={styles.unit}>{metric ? 'KM/H' : 'MPH'}</Text>
            </View>
          </View>
          {road && (
            <View style={[styles.roadBadge, { backgroundColor: palette.card }]}>
              {shield && (
                <View style={styles.shield}>
                  <Text style={styles.shieldLabel}>
                    {/^I|^Interstate/i.test(g?.highway ?? road)
                      ? 'INTERSTATE'
                      : 'US'}
                  </Text>
                  <Text style={styles.shieldNumber}>{shield[1]}</Text>
                </View>
              )}
              <Text
                style={[styles.currentRoad, { color: palette.text }]}
                numberOfLines={1}
              >
                {road}
              </Text>
            </View>
          )}
        </View>
      )}
      {placement !== 'maneuver' && summary}
      {placement === 'all' && (
        <View style={[styles.detailCopy, { backgroundColor: palette.card }]}>
          {destination && (
            <Text style={[styles.detail, { color: palette.text }]}>
              Destination: {destination}
            </Text>
          )}
          <Text style={[styles.detail, { color: palette.text }]}>
            {data.speedMps === undefined
              ? 'GPS speed unavailable'
              : 'GPS speed: ' + speed + (metric ? ' km/h' : ' mph')}
            {!data.gpsFresh ? ' · Waiting for fresh GPS' : ''}
          </Text>
          {g?.speedLimitMph !== undefined && (
            <Text style={[styles.detail, { color: palette.text }]}>
              Provider speed limit: {limit} {metric ? 'km/h' : 'mph'}
            </Text>
          )}
          {progress && (
            <Text style={[styles.detail, { color: palette.text }]}>
              Leg {progress.legNumber} of {progress.legCount}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 4,
  },
  previewIcon: {
    width: 36,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FF6B2C18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEyebrow: {
    color: '#D9753C',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  previewDestination: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  previewCaption: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  panelInstruction: { fontSize: 21, color: 'white', fontWeight: '800' },
  panelRoad: { fontSize: 16 },
  distancePill: { backgroundColor: '#233D4B', borderRadius: 14, padding: 12 },
  pillText: { color: 'white', fontWeight: '900', fontSize: 16 },
  stack: { gap: 8 },
  grow: { flex: 1 },
  maneuver: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#1D1E20',
    borderWidth: 1,
    borderColor: '#58595A',
    elevation: 8,
  },
  panelManeuver: {
    backgroundColor: '#0B202D',
    borderWidth: 0,
    borderRadius: 0,
    elevation: 0,
    minHeight: 110,
  },
  symbolBox: { width: 46, justifyContent: 'center', alignItems: 'center' },
  orangeSymbol: {
    width: 58,
    minHeight: 60,
    borderRadius: 22,
    backgroundColor: '#FF6425',
  },
  symbol: { fontSize: 54, color: 'white', fontWeight: '600' },
  instruction: { color: '#CFD0D1', fontSize: 16, fontWeight: '700' },
  roadTitle: { color: 'white', fontSize: 25, fontWeight: '900', marginTop: 3 },
  maneuverDistance: {
    color: 'white',
    fontSize: 32,
    fontWeight: '900',
    marginTop: 5,
  },
  toward: { color: '#CCD1D6', fontSize: 14, fontWeight: '600', marginTop: 6 },
  then: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderRadius: 12,
    backgroundColor: '#202123',
  },
  thenText: { color: 'white', fontSize: 14, flex: 1 },
  exit: {
    backgroundColor: '#108950',
    color: 'white',
    padding: 6,
    borderRadius: 8,
    fontWeight: '800',
  },
  instruments: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 64,
  },
  nightSpeedCard: { backgroundColor: '#DBE4ED' },
  speedCard: {
    minWidth: 106,
    minHeight: 68,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 6,
    borderWidth: 2,
    borderColor: '#1C2446',
    borderRadius: 15,
    backgroundColor: '#FFF',
    elevation: 4,
  },
  limit: {
    minWidth: 44,
    padding: 5,
    borderWidth: 2,
    borderColor: '#1C2446',
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitNumber: { color: '#1C2446', fontSize: 24, fontWeight: '900' },
  limitLabel: { color: '#1C2446', fontSize: 10, fontWeight: '800' },
  speed: { justifyContent: 'center', alignItems: 'center', minWidth: 34 },
  speedNumber: { color: '#0A69BB', fontSize: 28, fontWeight: '900' },
  unit: { color: '#1C2446', fontSize: 11, fontWeight: '800' },
  roadBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#111214',
    borderRadius: 20,
    minHeight: 60,
    padding: 8,
    elevation: 4,
  },
  currentRoad: { color: 'white', fontSize: 18, fontWeight: '800', flex: 1 },
  shield: {
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 8,
    backgroundColor: '#074899',
    minWidth: 37,
    alignItems: 'center',
    overflow: 'hidden',
  },
  shieldLabel: {
    color: 'white',
    backgroundColor: '#C92438',
    fontSize: 7,
    padding: 2,
  },
  shieldNumber: { color: 'white', fontSize: 21, fontWeight: '900' },
  summary: {
    backgroundColor: 'white',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    elevation: 3,
    minHeight: 70,
    borderWidth: 1,
  },
  panelSummary: {
    backgroundColor: '#0D2230',
    borderRadius: 0,
    padding: 18,
    elevation: 0,
  },
  brand: {
    backgroundColor: '#FF6425',
    width: 38,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandImage: { width: 34, height: 34 },
  summaryBody: { flex: 1, alignItems: 'center' },
  totals: {
    color: '#1C2446',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  divider: { color: '#ABB0BD', fontWeight: '400' },
  eta: {
    color: '#747E90',
    fontWeight: '600',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  panelMuted: { color: '#A9BCCA', fontSize: 16 },
  white: { color: 'white', fontSize: 30 },
  more: {
    backgroundColor: '#ECECF2',
    borderRadius: 14,
    minWidth: 48,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreChevron: { color: '#596078', fontSize: 22, lineHeight: 24 },
  moreText: { color: '#596078', fontWeight: '800', fontSize: 12 },
  detailCopy: { backgroundColor: '#172433', borderRadius: 12, padding: 8 },
  detail: { color: '#E2E9EE', fontSize: 12 },
});
