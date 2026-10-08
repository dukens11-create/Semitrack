import {routeDisplayProgress} from '../navigation/routeDisplayProgress';
import { cameraPolicy } from './cameraPolicy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { CopilotMapView } from '../../components/CopilotMapView';
import {
  coordinateSchema,
  type Coordinate,
  type TruckRoute,
} from '../../models/contracts';
import type { StopPlan } from '../stops/StopPlan';
import type { LocationFix } from '../../services/location/LocationService';
import type { Poi } from '../poi/PoiService';
import { DriverIcon } from '../../components/DriverIcon';
import { useDriverPalette } from '../../components/DriverUI';
import { PoiArtwork } from '../poi/PoiPresentation';
type Props = {
  token: string;
  route: TruckRoute | null;
  plan: StopPlan | null;
  fix: LocationFix | null;
  night: boolean;
  navigationActive?: boolean;
  maneuverMeters?: number;
  progressOffset?: number;
  satellite?: boolean;
  autoZoom?: boolean;
  overviewRequest?: number;
  recenterRequest?: number;
  pois: Poi[];
  onPoi?: (poi: Poi) => void;
  onCoordinate?: (point: Coordinate) => void;
  bottomInset?: number;
  topInset?: number;
};
const routeLineStyle = {
  lineColor: '#168BE8',
  lineWidth: 5,
  lineCap: 'round',
  lineJoin: 'round',
} as const;
const alternativeLineStyle = {
  lineColor: '#8B5CF6',
  lineWidth: 3,
  lineDasharray: [2, 2],
};
const traveledRouteStyle = {
  lineColor: '#7E8A97',
  lineWidth: 5,
} as const;
export function TruckMap({
  token,
  route,
  plan,
  fix,
  night,
  navigationActive = false,
  maneuverMeters,
  progressOffset,
  satellite = false,
  autoZoom = true,
  overviewRequest = 0,
  recenterRequest = 0,
  pois,
  onPoi,
  onCoordinate,
  bottomInset = 0,
  topInset = 56,
}: Props) {
  const palette = useDriverPalette();
  const progress=useMemo(()=>routeDisplayProgress(route,navigationActive?progressOffset:undefined),[route,navigationActive,progressOffset]);
  const camera = useRef<Mapbox.Camera>(null);
  const [follow, setFollow] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapHeight, setMapHeight] = useState(600);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [nativeMapReady, setNativeMapReady] = useState(false);
  const [nativeMapError, setNativeMapError] = useState(false);
  // The presence of a native ViewManager is not proof that the vendor map
  // fragment exists. CoPilotViewManager.createViewInstance dereferences a null
  // fragment and crashes Android when the map is mounted before provisioning.
  // Keep CoPilot view creation disabled until native startup, entitlements,
  // map inventory and fragment readiness are independently verified on-device.
  // Mapbox is display-only; it never enables CoPilot truck guidance.
  const copilotFragmentReadinessVerified = false;
  const nativeCopilotViewAvailable = useMemo(() => {
    if (Platform.OS !== 'android' || !copilotFragmentReadinessVerified) return false;
    try {
      return !!UIManager.getViewManagerConfig?.('CopilotView');
    } catch {
      return false;
    }
  }, []);
  useEffect(() => {
    if (!nativeCopilotViewAvailable) return;
    let active = true;
    setNativeMapReady(false);
    setNativeMapError(false);
    const startup = NativeModules.CopilotStartupMgr as
      | { bindCoPilotService?: () => Promise<void> | void }
      | undefined;
    if (!startup || typeof startup.bindCoPilotService !== 'function') {
      setNativeMapError(true);
      return () => { active = false; };
    }
    // Treat a synchronous throw and a rejected promise as startup failures.
    Promise.resolve()
      .then(() => startup.bindCoPilotService!())
      .then(() => { if (active) setNativeMapReady(true); })
      .catch(() => { if (active) setNativeMapError(true); });
    return () => { active = false; };
  }, [nativeCopilotViewAvailable]);
  useEffect(() => {
    // Mapbox token initialization must not mutate CoPilot startup state.
    if (nativeCopilotViewAvailable) return;
    let active = true;
    setReady(false);
    setMapError(false);
    setMapLoaded(false);
    if (token) {
      void Mapbox.setAccessToken(token)
        .then(() => { if (active) setReady(true); })
        .catch(() => { if (active) setMapError(true); });
    }
    return () => { active = false; };
  }, [token, nativeCopilotViewAvailable]);
  useEffect(() => {
    // A GPS fix may arrive before the native map/camera mounts. Replay it on load.
    if (mapLoaded && follow && fix) {
      const policy = cameraPolicy(
        fix,
        navigationActive,
        maneuverMeters,
        Date.now(),
        autoZoom,
      );
      if (policy) camera.current?.setCamera(policy);
    }
  }, [fix, follow, mapLoaded, navigationActive, maneuverMeters, autoZoom]);
  const overview = useCallback(() => {
    if (!route) return;
    setFollow(false);
    const bounds = [
      route.routeGeometry,
      ...route.alternatives.map(item => item.routeGeometry),
    ]
      .flat()
      .reduce(
        (acc, [lng, lat]) => ({
          minLng: Math.min(acc.minLng, lng),
          maxLng: Math.max(acc.maxLng, lng),
          minLat: Math.min(acc.minLat, lat),
          maxLat: Math.max(acc.maxLat, lat),
        }),
        { minLng: 180, maxLng: -180, minLat: 90, maxLat: -90 },
      );
    camera.current?.fitBounds(
      [bounds.maxLng, bounds.maxLat],
      [bounds.minLng, bounds.minLat],
      [topInset + 24, 64, bottomInset + 32, 24],
      700,
    );
  }, [route, topInset, bottomInset]);
  useEffect(() => {
    if (overviewRequest > 0 && mapLoaded && route) overview();
  }, [overviewRequest, mapLoaded, route, overview]);
  useEffect(() => {
    if (recenterRequest <= 0 || !mapLoaded || !fix) return;
    setFollow(true);
    const policy = cameraPolicy(
      fix,
      navigationActive,
      maneuverMeters,
      Date.now(),
      autoZoom,
    );
    if (policy) camera.current?.setCamera(policy);
  }, [
    recenterRequest,
    mapLoaded,
    fix,
    navigationActive,
    maneuverMeters,
    autoZoom,
  ]);
  if (nativeCopilotViewAvailable) {
    return (
      <View style={styles.fill} onLayout={event => setMapHeight(event.nativeEvent.layout.height)}>
        <View style={styles.frame}>
          {nativeMapReady && <CopilotMapView style={styles.map} />}
          {!nativeMapReady && (
            <View pointerEvents="none" style={styles.nativeOverlay}>
              <Text style={[styles.stateTitle, { color: palette.text }]}>
                {nativeMapError ? 'CoPilot map unavailable' : 'Starting CoPilot map…'}
              </Text>
              <Text style={[styles.stateText, { color: palette.muted }]}>
                {nativeMapError
                  ? 'CoPilot native startup failed. Check license, maps, and device logs. Truck guidance remains blocked.'
                  : 'Connecting to the native CoPilot service.'}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }
  if (!token || mapError || !ready) {
    return (
      <View
        testID="map-unavailable"
        style={[styles.unavailable, { backgroundColor: palette.canvas }]}
      >
        <DriverIcon name="map_outlined" size={44} color={palette.muted} />
        <Text style={[styles.stateTitle, { color: palette.text }]}>
          {!ready && token && !mapError ? 'Loading map…' : 'Map unavailable'}
        </Text>
        <Text style={[styles.stateText, { color: palette.muted }]}>
          {!token
            ? 'Map display is unavailable until a public Mapbox token is configured.'
            : mapError
            ? 'Map provider could not initialize. Verify the display configuration.'
            : 'Connecting to Mapbox…'}
        </Text>
      </View>
    );
  }
  const markers = [...(plan?.stops ?? []), ...(plan ? [plan.destination] : [])];
  return (
    <View
      style={styles.fill}
      onLayout={event => setMapHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.frame}>
        <Mapbox.MapView
          style={styles.map}
          scaleBarEnabled={false}
          compassPosition={{ top: topInset + 12, right: 12 }}
          logoPosition={{ bottom: bottomInset + 8, left: 12 }}
          attributionPosition={{ bottom: bottomInset + 8, left: 110 }}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          styleURL={
            satellite
              ? Mapbox.StyleURL.SatelliteStreet
              : night
              ? Mapbox.StyleURL.Dark
              : Mapbox.StyleURL.Street
          }
          onLongPress={feature => {
            if (
              !feature?.geometry ||
              feature.geometry.type !== 'Point' ||
              !Array.isArray(feature.geometry.coordinates)
            )
              return;
            const point = coordinateSchema.safeParse({
              lng: feature.geometry.coordinates[0],
              lat: feature.geometry.coordinates[1],
            });
            if (point.success) onCoordinate?.(point.data);
          }}
          onTouchStart={() => setFollow(false)}
          onMapLoadingError={() => setMapError(true)}
        >
          <Mapbox.Camera
            ref={camera}
            padding={{
              paddingTop: topInset + 16,
              paddingBottom: bottomInset + 24,
              paddingLeft: 24,
              paddingRight: 64,
            }}
            defaultSettings={{
              // Fallback is an overview, never a claimed driver position.
              centerCoordinate: fix
                ? [fix.longitude, fix.latitude]
                : [-98.5, 38.5],
              zoomLevel: fix ? 15 : 5,
              heading: 0,
              pitch: 0,
            }}
          />
          {route?.alternatives.map((alternative, index) => (
            <Mapbox.ShapeSource
              key={alternative.id}
              id={'truck-alternative-' + index}
              shape={{
                type: 'Feature',
                properties: { previewOnly: true },
                geometry: {
                  type: 'LineString',
                  coordinates: alternative.routeGeometry,
                },
              }}
            >
              <Mapbox.LineLayer
                id={'truck-alternative-line-' + index}
                style={alternativeLineStyle}
              />
            </Mapbox.ShapeSource>
          ))}
          {progress && progress.traveled.length>=2 && (
            <Mapbox.ShapeSource
              id="traveled-route"
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: progress.traveled,
                },
              }}
            >
              <Mapbox.LineLayer id="traveled-route-line" style={traveledRouteStyle} />
            </Mapbox.ShapeSource>
          )}
          {route && (
            <Mapbox.ShapeSource
              id="truck-route"
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: progress && progress.remaining.length>=2 ? progress.remaining : route.routeGeometry,
                },
              }}
            >
              <Mapbox.LineLayer id="truck-route-line" style={routeLineStyle} />
            </Mapbox.ShapeSource>
          )}
          {markers.map((stop, index) => (
            <Mapbox.PointAnnotation
              key={stop.id}
              id={stop.id}
              coordinate={[stop.lng, stop.lat]}
            >
              <View style={styles.marker}>
                <Text style={styles.markerText}>
                  {index === markers.length - 1 ? 'D' : String(index + 1)}
                </Text>
              </View>
            </Mapbox.PointAnnotation>
          ))}
          {pois.map(poi => (
            <Mapbox.MarkerView
              key={poi.id}
              id={'poi-' + poi.id}
              coordinate={[poi.longitude, poi.latitude]}
              anchor={{ x: 0.5, y: 1 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={poi.name}
                onPress={() => onPoi?.(poi)}
              >
                <PoiArtwork poi={poi} pin />
              </Pressable>
            </Mapbox.MarkerView>
          ))}
          {fix && (
            <Mapbox.MarkerView
              id="truck-position"
              coordinate={[fix.longitude, fix.latitude]}
              anchor={{ x: 0.5, y: 0.62 }}
            >
              <Image
                accessibilityLabel="Truck GPS position"
                source={require('../../assets/original/icons/truck_top.png')}
                resizeMode="contain"
                style={[
                  styles.truck,
                  {
                    transform: [
                      {
                        rotate:
                          String(navigationActive ? 0 : fix.heading ?? 0) +
                          'deg',
                      },
                    ],
                  },
                ]}
              />
            </Mapbox.MarkerView>
          )}
        </Mapbox.MapView>
      </View>
      <View
        style={[
          styles.controls,
          { bottom: bottomInset + 36 },
          mapHeight < 360 && styles.horizontalControls,
        ]}
      >
        {!follow && <Text style={styles.freePan}>Free pan · Follow off</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter / follow truck"
          accessibilityState={{ disabled: !fix }}
          disabled={!fix}
          style={[styles.control, !fix && styles.disabled]}
          onPress={() => {
            setFollow(true);
            const policy = cameraPolicy(
              fix,
              navigationActive,
              maneuverMeters,
              Date.now(),
              autoZoom,
            );
            if (policy) camera.current?.setCamera(policy);
          }}
        >
          <DriverIcon name="my_location_rounded" color="#172433" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compass / north up"
          onPress={() => {
            setFollow(false);
            camera.current?.setCamera({
              heading: 0,
              pitch: 0,
              animationDuration: 300,
            });
          }}
          style={styles.control}
        >
          <View style={styles.compassFace}>
            <Text style={styles.compassNorth}>N</Text>
            <Text style={styles.compassNeedle}>▲</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Route overview"
          accessibilityState={{ disabled: !route }}
          disabled={!route}
          onPress={overview}
          style={[styles.control, !route && styles.disabled]}
        >
          <DriverIcon name="route_rounded" color="#172433" />
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  freePan: {
    backgroundColor: '#172433',
    color: 'white',
    padding: 5,
    maxWidth: 96,
    borderRadius: 8,
  },
  fill: { flex: 1 },
  frame: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  nativeOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(23, 36, 51, 0.78)',
    gap: 4,
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 100,
    gap: 12,
  },
  stateTitle: { fontSize: 20, fontWeight: '800' },
  stateText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  marker: { backgroundColor: '#172433', padding: 8, borderRadius: 18 },
  markerText: { color: 'white', fontWeight: '800' },
  truck: { width: 48, height: 48 },
  // AppRoot and the tab shell already consume the system safe areas.
  controls: { position: 'absolute', right: 12, gap: 8 },
  horizontalControls: { flexDirection: 'row' },
  compassFace: { alignItems: 'center', justifyContent: 'center' },
  compassNorth: {
    color: '#172433',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 11,
  },
  compassNeedle: { color: '#E24A2A', fontSize: 17, lineHeight: 18 },
  control: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  disabled: { opacity: 0.4 },
});
