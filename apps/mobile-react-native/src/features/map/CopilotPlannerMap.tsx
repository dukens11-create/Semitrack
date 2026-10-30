import React, { useEffect, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CopilotOfflineMap,
  copilotMapBlocker,
} from '../../components/CopilotOfflineMap';
import { useDriverPalette } from '../../components/DriverUI';
import { DriverIcon, type DriverIconName } from '../../components/DriverIcon';
import { useCopilotState } from '../../services/copilot/CopilotProvider';
import { coPilotHost } from '../../services/copilot/CoPilotHost';
import {
  coordinateSchema,
  type Coordinate,
  type TruckRoute,
} from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
import type { Poi } from '../poi/PoiService';

export function CopilotPlannerMap({
  route,
  plan,
  pois,
  command,
  topInset = 56,
  bottomInset = 0,
  onPoi,
  onCoordinate,
  onAudio,
}: {
  route: TruckRoute;
  plan: StopPlan | null;
  pois: Poi[];
  command?: { type: 'overview' | 'recenter'; id: number };
  topInset?: number;
  bottomInset?: number;
  onPoi?: (poi: Poi) => void;
  onCoordinate?: (point: Coordinate) => void;
  onAudio?: () => void;
}) {
  const state = useCopilotState();
  const palette = useDriverPalette();
  const blocker = copilotMapBlocker(state);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const queue = useRef(Promise.resolve());
  const geometryKey = JSON.stringify(route.routeGeometry);
  const latest = useRef({ route, plan, pois, onPoi, onCoordinate });
  latest.current = { route, plan, pois, onPoi, onCoordinate };
  async function overview() {
    const points = latest.current.route.routeGeometry;
    if (!points.length) return;
    const lngs = points.map(p => p[0]),
      lats = points.map(p => p[1]);
    await coPilotHost().mapFrame(
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    );
  }
  useEffect(() => {
    let current = true;
    setReady(false);
    if (blocker) return;
    // Serialize shared native display updates; stale work stops before its next call.
    queue.current = queue.current
      .then(async () => {
        if (!current) return;
        await coPilotHost().setMapAppearance(palette.dark);
        if (current) {
          setReady(true);
          setError('');
        }
      })
      .catch(() => {
        if (current)
          setError(
            'Unable to open the CoPilot route preview. Check navigation setup.',
          );
      });
    return () => {
      current = false;
    };
  }, [blocker, palette.dark]);
  useEffect(() => {
    let current = true;
    if (!ready || blocker) return;
    queue.current = queue.current
      .then(async () => {
        if (!current) return;
        await coPilotHost().drawRoutePreview(JSON.parse(geometryKey));
        if (!current) return;
        await overview();
      })
      .catch(() => {
        if (current) setError('Route preview could not be displayed.');
      });
    return () => {
      current = false;
    };
  }, [ready, blocker, geometryKey]);
  useEffect(() => {
    let current = true;
    if (!ready || blocker) return;
    const stops = [...(plan?.stops ?? []), ...(plan ? [plan.destination] : [])];
    const markers = [
      ...pois
        .slice(0, 450)
        .map((p, id) => ({ id, lat: p.latitude, lng: p.longitude })),
      ...stops.map((p, i) => ({ id: 450 + i, lat: p.lat, lng: p.lng })),
    ];
    const picked = DeviceEventEmitter.addListener(
      'SemiTraxCoPilotMarkerPicked',
      (value: { id?: number }) => {
        if (
          typeof value.id !== 'number' ||
          !Number.isInteger(value.id) ||
          value.id < 0 ||
          value.id >= Math.min(450, pois.length)
        )
          return;
        const selected = pois[value.id];
        if (selected) latest.current.onPoi?.(selected);
      },
    );
    const location = DeviceEventEmitter.addListener(
      'SemiTraxCoPilotMapPicked',
      (value: unknown) => {
        const result = coordinateSchema.safeParse(value);
        if (result.success) latest.current.onCoordinate?.(result.data);
      },
    );
    queue.current = queue.current
      .then(async () => {
        if (current) await coPilotHost().drawMarkers(markers);
      })
      .catch(() => {
        if (current) setError('Some places could not be displayed.');
      });
    return () => {
      current = false;
      picked.remove();
      location.remove();
    };
  }, [ready, blocker, plan, pois]);
  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError('');
    } catch {
      setError('Map control unavailable. Check navigation setup.');
    }
  }
  useEffect(() => {
    if (!ready || blocker || !command) return;
    void run(() =>
      command.type === 'overview'
        ? overview()
        : coPilotHost().mapCommand('recenter'),
    );
  }, [command, ready, blocker]);
  const controls: [
    string,
    () => Promise<void>,
    DriverIconName | null,
    string,
  ][] = [
    [
      'Recenter / follow truck',
      () => coPilotHost().mapCommand('recenter'),
      'my_location_rounded',
      '',
    ],
    ['Route overview', overview, 'route_rounded', ''],
    [
      'Compass / north up',
      () => coPilotHost().mapCommand('north-up'),
      null,
      'N↑',
    ],
    ['Zoom in', () => coPilotHost().mapCommand('zoom-in'), null, '+'],
    ['Zoom out', () => coPilotHost().mapCommand('zoom-out'), null, '−'],
  ];
  return (
    <View style={styles.fill}>
      {(ready || blocker) && <CopilotOfflineMap state={state} />}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[
            styles.error,
            {
              top: topInset,
              backgroundColor: palette.card,
              color: palette.text,
            },
          ]}
        >
          {error}
        </Text>
      )}
      <ScrollView
        testID="copilot-map-tools"
        accessibilityLabel="Map tools"
        showsVerticalScrollIndicator
        bounces={false}
        contentContainerStyle={styles.controlContent}
        style={[
          styles.controls,
          { top: topInset + 16, bottom: bottomInset + 20 },
        ]}
      >
        {controls.map(([label, action, icon, symbol]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={!ready || !!blocker}
            accessibilityState={{ disabled: !ready || !!blocker }}
            onPress={() => {
              void run(action);
            }}
            style={[styles.button, { backgroundColor: palette.card }]}
          >
            {icon ? (
              <DriverIcon name={icon} size={28} color={palette.text} />
            ) : (
              <Text
                accessible={false}
                allowFontScaling={false}
                style={[styles.symbol, { color: palette.text }]}
              >
                {symbol}
              </Text>
            )}
          </Pressable>
        ))}
        {onAudio && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Audio Settings"
            onPress={onAudio}
            style={[styles.button, { backgroundColor: palette.card }]}
          >
            <DriverIcon name="volume_up" size={28} color={palette.text} />
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: { position: 'absolute', right: 12, width: 52 },
  controlContent: { gap: 8, paddingBottom: 4 },
  symbol: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  button: {
    height: 48,
    width: 48,
    flexShrink: 0,
    padding: 8,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: { position: 'absolute', left: 12, right: 110, padding: 12 },
});
