import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { engineMapProof, laneDirectionSymbol } from './engineMapProof';
import { useEngineMapSnapshot } from './useEngineMapSnapshot';
import {DrivingNearbyOverlay} from '../navigation/DrivingNearbyOverlay';
import type {Poi, PoiService} from '../poi/PoiService';
import type {LocationFix} from '../../services/location/LocationService';
import {CoPilotVoiceControls} from '../../components/CoPilotVoiceControls';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

/** Live engine display. Native trip controls retain ownership of start/end/profile/voice. */
export function EngineMapboxProof({ token, onClose, nearbyService, fix, onPoi }: { token: string; onClose: () => void; nearbyService?: Pick<PoiService, 'nearby'>; fix?: LocationFix | null; onPoi?: (poi: Poi) => void }) {
  const insets = useSafeAreaInsets();
  const [selectedPoi, setSelectedPoi] = useState<Poi>();
  const [follow, setFollow] = useState(true);
  const [zoom, setZoom] = useState(14);
  const [mapHeight, setMapHeight] = useState(0);
  const { sample, now } = useEngineMapSnapshot();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState('');
  const [satellite, setSatellite] = useState(false);
  const camera = useRef<Mapbox.Camera>(null);
  useEffect(() => {
    let current = true;
    if (!token.startsWith('pk.')) { setMapError('Mapbox public display token is missing.'); return; }
    void Mapbox.setAccessToken(token).then(() => { if (current) setReady(true); })
      .catch(() => { if (current) setMapError('Mapbox could not initialize.'); });
    return () => { current = false; };
  }, [token]);
  const data = engineMapProof(sample, now);
  useEffect(() => {
    if (loaded && follow && data.position) camera.current?.setCamera({
      centerCoordinate: data.position, zoomLevel: zoom,
      heading: data.heading ?? 0, animationDuration: 500,
    });
  }, [loaded, follow, zoom, data.position, data.heading]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
        <View style={styles.header}>
          <Text style={styles.title}>SemiTraX Navigation</Text>
          <Text style={styles.copy}>{data.status}</Text>
          <Text style={styles.turn}>{data.instruction || 'Waiting for engine guidance.'}</Text>
          {!!data.exitNumber && <Text style={styles.exit}>EXIT {data.exitNumber}</Text>}
          {!!data.laneDirections?.length && <View accessibilityLabel="Lane directions from left to right" style={styles.lanes}>{data.laneDirections.map((code, index) => <Text key={index} accessibilityLabel={`Lane ${index + 1}: ${code.replace(/_/g, ' ')}`} style={styles.lane}>{laneDirectionSymbol(code)}</Text>)}</View>}
          {!!data.nextRoad && <Text style={styles.copy}>{data.turnDistance} · {data.nextRoad}</Text>}
        </View>
        <View style={styles.map} onLayout={event => setMapHeight(event.nativeEvent.layout.height)}>
          {ready && <Mapbox.MapView
            style={styles.fill}
            onTouchStart={() => setFollow(false)}
            styleURL={satellite ? Mapbox.StyleURL.SatelliteStreet : Mapbox.StyleURL.Street}
            onDidFinishLoadingMap={() => { setLoaded(true); setMapError(''); }}
            onMapLoadingError={() => { setLoaded(false); setMapError('Map unavailable. Check your connection or open Trip controls.'); }}
          >
            <Mapbox.Camera ref={camera} defaultSettings={{ centerCoordinate: [-119.8, 39.5], zoomLevel: 4 }} />
            {data.coordinates && <Mapbox.ShapeSource id="engine-route" shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: data.coordinates } }}>
              <Mapbox.LineLayer id="engine-route-line" style={stylesRoute} />
            </Mapbox.ShapeSource>}
            {data.position && <Mapbox.ShapeSource id="engine-position" shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: data.position } }}>
              <Mapbox.CircleLayer id="engine-position-dot" style={stylesPosition} />
            </Mapbox.ShapeSource>}
          </Mapbox.MapView>}
          {!!mapError && <View style={styles.error}><Text>{mapError}</Text></View>}
          <View style={styles.controls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Toggle satellite map" style={styles.control} onPress={() => { setLoaded(false); setSatellite(value => !value); }}><Text style={styles.copy}>{satellite ? 'Street' : 'Satellite'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Compass north up" style={styles.control} onPress={() => {setFollow(false); camera.current?.setCamera({heading: 0, animationDuration: 300});}}><Text style={styles.title}>{data.compass ?? '—'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" style={styles.control} onPress={() => {const next = Math.min(19, zoom + 1); setZoom(next); camera.current?.setCamera({zoomLevel: next, animationDuration: 300});}}><Text style={styles.title}>＋</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" style={styles.control} onPress={() => {const next = Math.max(3, zoom - 1); setZoom(next); camera.current?.setCamera({zoomLevel: next, animationDuration: 300});}}><Text style={styles.title}>−</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Follow truck" style={styles.control} onPress={() => setFollow(true)}><Text style={styles.copy}>{follow ? 'Following' : 'Recenter'}</Text></Pressable>
          </View>
          {nearbyService && mapHeight > 240 && <View pointerEvents="box-none" style={styles.nearby}><DrivingNearbyOverlay service={nearbyService} fix={fix ?? null} active availableHeight={Math.min(280, mapHeight - 100)} onSelect={poi => {setSelectedPoi(poi); onPoi?.(poi);}}/></View>}
          <View style={styles.speed}>
            <View><Text style={styles.copy}>TRUCK LIMIT</Text><Text style={styles.speedNumber}>{data.truckSpeedLimitMph === undefined ? '—' : Math.round(data.truckSpeedLimitMph)}</Text></View>
            <View><Text style={styles.copy}>MPH</Text><Text style={styles.speedNumber}>{data.speedMph === undefined ? '—' : Math.round(data.speedMph)}</Text></View>
          </View>
        </View>
        {!!selectedPoi && <View style={styles.footer}><Text style={styles.metrics}>{selectedPoi.name}</Text><Text>{selectedPoi.category}</Text><Text>Availability and prices require verified provider data.</Text><Pressable accessibilityRole="button" onPress={() => setSelectedPoi(undefined)}><Text>Close place details</Text></Pressable></View>}
        <View style={styles.footer}>
          <Text style={styles.metrics}>
            {data.remainingMeters === undefined ? '—' : (data.remainingMeters / 1609.344).toFixed(1) + ' mi'}
            {' · '}{data.etaAt === undefined ? 'ETA —' : new Date(data.etaAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
            {' · '}{data.speedMph === undefined ? '— mph' : Math.round(data.speedMph) + ' mph'}
          </Text>
          <CoPilotVoiceControls />
          <Pressable accessibilityRole="button" accessibilityLabel="Trip controls" onPress={onClose} style={styles.button}>
            <Text style={styles.title}>Trip controls</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const stylesRoute = { lineColor: '#168BE8', lineWidth: 6, lineCap: 'round', lineJoin: 'round' } as const;
const stylesPosition = { circleRadius: 9, circleColor: '#FF6B2C', circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 };
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#172433' },
  header: { backgroundColor: '#172433', padding: 16, gap: 6 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  copy: { color: '#FFFFFF', fontSize: 13 },
  exit: {color: '#FFFFFF', backgroundColor: '#216746', paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', fontWeight: '800'},
  lanes: {flexDirection: 'row', flexWrap: 'wrap', gap: 4},
  lane: {color: '#FFFFFF', fontSize: 24, minWidth: 28, textAlign: 'center', borderRightWidth: 1, borderRightColor: '#647181'},
  turn: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  map: { flex: 1 }, fill: { flex: 1 },
  error: { position: 'absolute', top: 70, left: 12, right: 12, backgroundColor: '#FFFFFF', padding: 12 },
  controls: {position: 'absolute', right: 8, top: 8, gap: 6},
  control: {minHeight: 44, minWidth: 60, padding: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#172433', borderRadius: 10},
  nearby: {position: 'absolute', left: 8, top: 8, right: 86, alignItems: 'flex-start'},
  speed: {position: 'absolute', bottom: 36, left: 8, backgroundColor: '#172433', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 20},
  speedNumber: {fontSize: 30, fontWeight: '800', color: '#FFFFFF'},
  footer: { padding: 12, gap: 8, backgroundColor: '#FFFFFF' },
  metrics: { color: '#172433', fontSize: 20, fontWeight: '800' },
  button: { minHeight: 48, backgroundColor: '#FF6B2C', padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
