import { NavigationCompass } from './NavigationCompass';
import { useVehicleDisplay } from './vehicleDisplay';
import { routeDisplayProgress } from '../navigation/routeDisplayProgress';
import { cameraPolicy } from './cameraPolicy';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
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
  command?: { type: 'overview' | 'recenter'; id: number };
  route: TruckRoute | null;
  plan: StopPlan | null;
  fix: LocationFix | null;
  /** Deprecated: effective appearance is owned by the application provider. */
  night?: boolean;
  navigationActive?: boolean;
  maneuverMeters?: number;
  progressOffset?: number;
  satellite?: boolean;
  onToggleSatellite?: () => void;
  onAudio?: () => void;
  autoZoom?: boolean;
  pois: Poi[];
  onPoi?: (poi: Poi) => void;
  onCoordinate?: (point: Coordinate) => void;
  bottomInset?: number;
  topInset?: number;
};
const traveledLineStyle = { lineColor: '#7E8A97', lineWidth: 5 };
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
export function TruckMap({
  token,
  command,
  route,
  plan,
  fix,
  navigationActive = false,
  maneuverMeters,
  progressOffset,
  satellite = false,
  onToggleSatellite,
  onAudio,
  autoZoom = true,
  pois,
  onPoi,
  onCoordinate,
  bottomInset = 0,
  topInset = 56,
}: Props) {
  const palette = useDriverPalette();
  const night = palette.dark;
  const vehicle = useVehicleDisplay(fix);
  const lastCommand = useRef<number | undefined>(undefined);
  const previousRoute = useRef(route);
  const progress = useMemo(
    () =>
      routeDisplayProgress(
        route,
        navigationActive ? progressOffset : undefined,
      ),
    [route, navigationActive, progressOffset],
  );
  const camera = useRef<Mapbox.Camera>(null);
  const [follow, setFollow] = useState(true);
  const [cameraHeading, setCameraHeading] = useState<number | null>(null);
  const zoom = useRef(fix ? 15 : 5);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    setMapError(false);
    setMapLoaded(false);
    if (token) {
      void Mapbox.setAccessToken(token)
        .then(() => {
          if (active) {
            setReady(true);
          }
        })
        .catch(() => {
          if (active) {
            setMapError(true);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [token]);
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
    if (!route) {
      return;
    }
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
  const recenter = useCallback(() => {
    setFollow(true);
    const policy = cameraPolicy(
      fix,
      navigationActive,
      maneuverMeters,
      Date.now(),
      autoZoom,
    );
    if (policy) camera.current?.setCamera(policy);
  }, [fix, navigationActive, maneuverMeters, autoZoom]);
  useEffect(() => {
    if (previousRoute.current && !route) {
      setFollow(true);
      camera.current?.setCamera({
        heading: 0,
        pitch: 0,
        animationDuration: 300,
      });
    }
    previousRoute.current = route;
  }, [route]);
  useEffect(() => {
    if (!command || !mapLoaded || command.id === lastCommand.current) return;
    lastCommand.current = command.id;
    if (command.type === 'overview') overview();
    else recenter();
  }, [command, mapLoaded, overview, recenter]);
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
    <View style={styles.fill}>
      <View style={styles.frame}>
        <Mapbox.MapView
          style={styles.map}
          scaleBarEnabled={false}
          compassEnabled={false}
          compassPosition={{ top: topInset + 12, right: 12 }}
          logoPosition={{ bottom: bottomInset + 8, left: 12 }}
          attributionPosition={{ bottom: bottomInset + 8, left: 110 }}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          onCameraChanged={state => {
            if (Number.isFinite(state.properties.heading))
              setCameraHeading(state.properties.heading);
            if (Number.isFinite(state.properties.zoom))
              zoom.current = state.properties.zoom;
          }}
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
          {progress && progress.traveled.length >= 2 && (
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
              <Mapbox.LineLayer
                id="traveled-route-line"
                style={traveledLineStyle}
              />
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
                  coordinates:
                    progress && progress.remaining.length >= 2
                      ? progress.remaining
                      : route.routeGeometry,
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
              <View style={[styles.marker, { backgroundColor: palette.card }]}>
                <Text style={[styles.markerText, { color: palette.text }]}>
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
          {vehicle && (
            <Mapbox.MarkerView
              id="truck-position"
              coordinate={[vehicle.longitude, vehicle.latitude]}
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
                          String(
                            vehicle.heading === null
                              ? 0
                              : (((vehicle.heading - (cameraHeading ?? 0)) %
                                  360) +
                                  360) %
                                  360,
                          ) + 'deg',
                      },
                    ],
                  },
                ]}
              />
            </Mapbox.MarkerView>
          )}
        </Mapbox.MapView>
      </View>
      <ScrollView
        testID="map-tools"
        accessibilityLabel="Map tools"
        showsVerticalScrollIndicator
        indicatorStyle={palette.dark ? 'white' : 'black'}
        bounces={false}
        style={[
          styles.controls,
          { top: topInset + 16, bottom: bottomInset + 20 },
        ]}
        contentContainerStyle={styles.controlContent}
      >
        <View style={styles.controlGroup}>
          {!follow && (
            <Text
              style={[
                styles.freePan,
                { backgroundColor: palette.card, color: palette.text },
              ]}
            >
              Follow off
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recenter / follow truck"
            accessibilityState={{ disabled: !fix }}
            disabled={!fix}
            style={[
              styles.roundControl,
              { backgroundColor: palette.card, borderColor: palette.border },
              !fix && styles.disabled,
            ]}
            onPress={recenter}
          >
            <DriverIcon
              name="my_location_rounded"
              color={palette.text}
              size={30}
            />
          </Pressable>
          {!navigationActive && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Route overview"
              accessibilityState={{ disabled: !route }}
              disabled={!route}
              onPress={overview}
              style={[
                styles.roundControl,
                { backgroundColor: palette.card, borderColor: palette.border },
                !route && styles.disabled,
              ]}
            >
              <DriverIcon name="route_rounded" color={palette.text} />
            </Pressable>
          )}
        </View>
        <View style={styles.controlGroup}>
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
            style={[
              styles.roundControl,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <NavigationCompass bearing={cameraHeading} />
          </Pressable>
          {onToggleSatellite && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle satellite map"
              accessibilityState={{ selected: satellite }}
              onPress={onToggleSatellite}
              style={[
                styles.roundControl,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <DriverIcon name="satellite" color={palette.text} size={26} />
            </Pressable>
          )}
        </View>
        <View style={styles.controlGroup}>
          <View
            style={[
              styles.zoomGroup,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            {([1, -1] as const).map(direction => (
              <Pressable
                key={direction}
                accessibilityRole="button"
                accessibilityLabel={direction === 1 ? 'Zoom in' : 'Zoom out'}
                onPress={() => {
                  setFollow(false);
                  zoom.current = Math.max(
                    2,
                    Math.min(20, zoom.current + direction),
                  );
                  camera.current?.setCamera({
                    zoomLevel: zoom.current,
                    animationDuration: 200,
                  });
                }}
                style={styles.zoomButton}
              >
                <Text style={[styles.zoomText, { color: palette.text }]}>
                  {direction === 1 ? '+' : '−'}
                </Text>
              </Pressable>
            ))}
          </View>
          {onAudio && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Audio Settings"
              accessibilityHint="Open guidance voice preferences; licensing is still required for spoken guidance"
              onPress={onAudio}
              style={[
                styles.roundControl,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <DriverIcon name="volume_up" color={palette.text} size={28} />
            </Pressable>
          )}
        </View>
      </ScrollView>
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
  controls: {
    position: 'absolute',
    right: 12,
    width: 54,
  },
  controlContent: { alignItems: 'center', gap: 10, paddingVertical: 3 },
  controlGroup: { gap: 8, alignItems: 'center' },
  roundControl: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#161718F0',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  zoomGroup: {
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#FFFFFFF5',
    overflow: 'hidden',
  },
  zoomButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomText: { color: '#172433', fontSize: 32, fontWeight: '500' },
  sound: { color: 'white', fontSize: 30 },
  horizontalControls: { flexDirection: 'row' },
  compassFace: { alignItems: 'center', justifyContent: 'center' },
  compassNorth: {
    color: 'white',
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
