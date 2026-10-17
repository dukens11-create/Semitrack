import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
  route: TruckRoute | null;
  plan: StopPlan | null;
  fix: LocationFix | null;
  night: boolean;
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
const alternativeLineStyle = { lineColor: '#8B5CF6', lineWidth: 3, lineDasharray: [2, 2] };
export function TruckMap({
  token,
  route,
  plan,
  fix,
  night,
  pois,
  onPoi,
  onCoordinate,
  bottomInset = 0,
  topInset = 56,
}: Props) {
  const palette = useDriverPalette();
  const camera = useRef<Mapbox.Camera>(null);
  const [follow, setFollow] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapHeight, setMapHeight] = useState(600);
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
      camera.current?.setCamera({
        centerCoordinate: [fix.longitude, fix.latitude],
        zoomLevel: 15,
        heading: 0,
        pitch: 0,
        animationDuration: 700,
      });
    }
  }, [fix, follow, mapLoaded]);
  function overview() {
    if (!route) {
      return;
    }
    setFollow(false);
    const bounds = [route.routeGeometry, ...route.alternatives.map(item => item.routeGeometry)].flat().reduce(
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
          styleURL={night ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
          onLongPress={feature => {
            if (!feature?.geometry || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return;
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
            <Mapbox.ShapeSource key={alternative.id} id={'truck-alternative-' + index}
              shape={{ type: 'Feature', properties: { previewOnly: true },
                geometry: { type: 'LineString', coordinates: alternative.routeGeometry } }}>
              <Mapbox.LineLayer id={'truck-alternative-line-' + index}
                style={alternativeLineStyle} />
            </Mapbox.ShapeSource>
          ))}
          {route && (
            <Mapbox.ShapeSource
              id="truck-route"
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: route.routeGeometry,
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
                  { transform: [{ rotate: String(fix.heading ?? 0) + 'deg' }] },
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter / follow truck"
          accessibilityState={{ disabled: !fix }}
          disabled={!fix}
          style={[styles.control, !fix && styles.disabled]}
          onPress={() => {
            setFollow(true);
            if (fix)
              camera.current?.setCamera({
                centerCoordinate: [fix.longitude, fix.latitude],
                zoomLevel: 15,
                heading: 0,
                pitch: 0,
              });
          }}
        >
          <DriverIcon name="my_location_rounded" color="#172433" />
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
  controls: { position: 'absolute', right: 12, gap: 8 },
  horizontalControls: { flexDirection: 'row' },
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
