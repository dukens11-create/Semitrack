import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Coordinate, TruckRoute } from '../../models/contracts';
import { coordinateSchema } from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
import type { Poi } from '../poi/PoiService';
import type { LocationFix } from '../../services/location/LocationService';
import { useDriverPalette } from '../../components/DriverUI';
import {
  CopilotOfflineMap,
  copilotMapBlocker,
} from '../../components/CopilotOfflineMap';
import { useCopilotState } from '../../services/copilot/CopilotProvider';
import { coPilotHost } from '../../services/copilot/CoPilotHost';
import { routeDisplayProgress } from '../navigation/routeDisplayProgress';
export interface CopilotMapProps {
  command?: { type: 'overview' | 'recenter'; id: number };
  route: TruckRoute | null;
  plan: StopPlan | null;
  fix: LocationFix | null;
  pois: Poi[];
  onPoi?: (poi: Poi) => void;
  onCoordinate?: (point: Coordinate) => void;
  navigationActive?: boolean;
  progressOffset?: number;
  topInset?: number;
  bottomInset?: number;
}
let nextMarkerId = 1;
/** Backend geometry is a dashed planning overlay, never a native guidance route. */
export function CopilotTruckMap({
  command,
  route,
  plan,
  pois,
  onPoi,
  onCoordinate,
  navigationActive,
  progressOffset,
  topInset = 56,
  bottomInset = 0,
}: CopilotMapProps) {
  const state = useCopilotState();
  const palette = useDriverPalette();
  const allowed = copilotMapBlocker(state) === null;
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [error, setError] = useState('');
  const [northUp, setNorthUp] = useState(true);
  const previousCommand = useRef<number | undefined>(undefined);
  const selected = useRef({ onPoi, onCoordinate, allowed: false });
  selected.current = { onPoi, onCoordinate, allowed };
  const geometry = useMemo(() => {
    const progress = routeDisplayProgress(
      route,
      navigationActive ? progressOffset : undefined,
    );
    return progress?.remaining ?? route?.routeGeometry ?? [];
  }, [progressOffset, navigationActive, route]);
  const markers = useMemo(() => {
    const positions = new Map<number, { poi?: Poi; point: Coordinate }>();
    const values: { id: number; lat: number; lng: number }[] = [];
    const add = (point: Coordinate, poi?: Poi) => {
      if (values.length >= 500 || !coordinateSchema.safeParse(point).success)
        return;
      const id = nextMarkerId++;
      positions.set(id, { point, poi });
      values.push({ id, ...point });
    };
    for (const poi of pois) add({ lat: poi.latitude, lng: poi.longitude }, poi);
    if (plan)
      for (const stop of [...plan.stops, plan.destination])
        add({ lat: stop.lat, lng: stop.lng });
    return { values, positions };
  }, [pois, plan]);
  const markerPositions = useRef(markers.positions);
  markerPositions.current = markers.positions;
  useEffect(() => {
    if (!allowed) {
      setAppearanceReady(false);
      return;
    }
    let active = true;
    void coPilotHost()
      .setMapAppearance(palette.dark)
      .then(() => {
        if (!active) return;
        setAppearanceReady(true);
        setError('');
      })
      .catch(() => {
        if (active) {
          setAppearanceReady(false);
          setError('CoPilot map appearance could not be applied. Retry setup.');
        }
      });
    return () => {
      active = false;
    };
  }, [allowed, palette.dark]);
  useEffect(() => {
    const picked = DeviceEventEmitter.addListener(
      'SemiTraxCoPilotMapPicked',
      raw => {
        if (!selected.current.allowed) return;
        const point = coordinateSchema.safeParse(raw);
        if (point.success) selected.current.onCoordinate?.(point.data);
      },
    );
    const marker = DeviceEventEmitter.addListener(
      'SemiTraxCoPilotMarkerPicked',
      raw => {
        if (!selected.current.allowed || !raw || !Number.isInteger(raw.id))
          return;
        const item = markerPositions.current.get(raw.id);
        if (!item) return;
        if (item.poi) selected.current.onPoi?.(item.poi);
        else selected.current.onCoordinate?.(item.point);
      },
    );
    return () => {
      picked.remove();
      marker.remove();
    };
  }, []);
  useEffect(() => {
    if (!allowed || !appearanceReady) return;
    let active = true;
    void coPilotHost()
      .drawRoutePreview(geometry)
      .catch(() => {
        if (active)
          setError(
            'The planning route could not be displayed. Guidance has not started.',
          );
      });
    return () => {
      active = false;
    };
  }, [allowed, appearanceReady, geometry]);
  useEffect(() => {
    if (!allowed || !appearanceReady) return;
    let active = true;
    void coPilotHost()
      .drawMarkers(markers.values)
      .catch(() => {
        if (active) setError('Map places could not be displayed.');
      });
    return () => {
      active = false;
    };
  }, [allowed, appearanceReady, markers]);
  async function control(action: string) {
    if (!allowed || !appearanceReady) return;
    try {
      if (action === 'overview' && geometry.length) {
        const longs = geometry.map(point => point[0]),
          lats = geometry.map(point => point[1]);
        await coPilotHost().mapFrame(
          Math.min(...longs),
          Math.min(...lats),
          Math.max(...longs),
          Math.max(...lats),
        );
      } else
        await coPilotHost().mapCommand(
          action === 'overview' ? 'recenter' : action,
        );
    } catch {
      setError('CoPilot map control is unavailable. Retry setup.');
    }
  }
  const currentControl = useRef(control);
  currentControl.current = control;
  useEffect(() => {
    if (
      !allowed ||
      !appearanceReady ||
      !command ||
      previousCommand.current === command.id
    )
      return;
    previousCommand.current = command.id;
    void currentControl.current(command.type);
  }, [allowed, appearanceReady, command]);
  return (
    <View style={styles.screen}>
      {allowed && !appearanceReady ? (
        <View style={[styles.pending, { backgroundColor: palette.canvas }]}>
          <Text style={{ color: palette.text }}>
            {error || 'Preparing CoPilot map…'}
          </Text>
        </View>
      ) : (
        <CopilotOfflineMap state={state} />
      )}
      {allowed && appearanceReady && (
        <View
          style={[styles.controls, { top: topInset, bottom: bottomInset + 16 }]}
          pointerEvents="box-none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recenter / follow truck"
            style={[styles.button, { backgroundColor: palette.card }]}
            onPress={() => {
              void control('recenter');
            }}
          >
            <Text style={[styles.symbol, { color: palette.text }]}>◎</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compass / north up"
            style={[styles.button, { backgroundColor: palette.card }]}
            onPress={() => {
              const next = !northUp;
              setNorthUp(next);
              void control(next ? 'north-up' : 'heading-up');
            }}
          >
            <Text style={[styles.symbol, { color: palette.text }]}>
              {northUp ? 'N' : '↑'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            style={[styles.button, { backgroundColor: palette.card }]}
            onPress={() => {
              void control('zoom-in');
            }}
          >
            <Text style={[styles.symbol, { color: palette.text }]}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            style={[styles.button, { backgroundColor: palette.card }]}
            onPress={() => {
              void control('zoom-out');
            }}
          >
            <Text style={[styles.symbol, { color: palette.text }]}>−</Text>
          </Pressable>
        </View>
      )}
      {!!error && (
        <View
          style={[
            styles.error,
            { backgroundColor: palette.card, bottom: bottomInset + 12 },
          ]}
          accessibilityRole="alert"
        >
          <Text style={{ color: palette.text }}>{error}</Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  pending: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  controls: {
    position: 'absolute',
    right: 12,
    gap: 10,
    alignItems: 'flex-end',
  },
  button: {
    width: 48,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { fontSize: 24, fontWeight: '700' },
  error: {
    position: 'absolute',
    left: 12,
    right: 72,
    padding: 12,
    borderRadius: 10,
  },
});
