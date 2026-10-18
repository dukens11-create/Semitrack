import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { engineMapProof } from './engineMapProof';
import { useEngineMapSnapshot } from './useEngineMapSnapshot';

/** Isolated read-only proof. Trip start/end/profile/voice remain owned by CoPilot. */
export function EngineMapboxProof({ token, onClose }: { token: string; onClose: () => void }) {
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
    if (loaded && data.position) camera.current?.setCamera({
      centerCoordinate: data.position, zoomLevel: 14,
      heading: data.heading ?? 0, animationDuration: 500,
    });
  }, [loaded, data.position, data.heading]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>SemiTraX Navigation</Text>
          <Text style={styles.copy}>{data.status}</Text>
          <Text style={styles.turn}>{data.instruction || 'Waiting for engine guidance.'}</Text>
          {!!data.nextRoad && <Text style={styles.copy}>{data.turnDistance} · {data.nextRoad}</Text>}
        </View>
        <View style={styles.map}>
          {ready && <Mapbox.MapView
            style={styles.fill}
            styleURL={satellite ? Mapbox.StyleURL.SatelliteStreet : Mapbox.StyleURL.Street}
            onDidFinishLoadingMap={() => { setLoaded(true); setMapError(''); }}
            onMapLoadingError={() => { setLoaded(false); setMapError('Mapbox map failed to load. Trip controls.'); }}
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
          <Pressable accessibilityRole="button" accessibilityLabel="Toggle satellite map" style={styles.satellite} onPress={() => { setLoaded(false); setSatellite(value => !value); }}>
            <Text style={styles.copy}>{satellite ? 'Street' : 'Satellite'}</Text>
          </Pressable>
        </View>
        <View style={styles.footer}>
          <Text style={styles.metrics}>
            {data.remainingMeters === undefined ? '—' : (data.remainingMeters / 1609.344).toFixed(1) + ' mi'}
            {' · '}{data.etaAt === undefined ? 'ETA —' : new Date(data.etaAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}
            {' · '}{data.speedMph === undefined ? '— mph' : Math.round(data.speedMph) + ' mph'}
          </Text>
          <Text>Use Trip controls to manage or end navigation.</Text>
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
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { backgroundColor: '#172433', padding: 16, gap: 6 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  copy: { color: '#FFFFFF', fontSize: 13 },
  turn: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  map: { flex: 1 }, fill: { flex: 1 },
  error: { position: 'absolute', top: 70, left: 12, right: 12, backgroundColor: '#FFFFFF', padding: 12 },
  satellite: { position: 'absolute', right: 12, top: 12, padding: 12, backgroundColor: '#172433', borderRadius: 12 },
  footer: { padding: 16, gap: 10 },
  metrics: { color: '#172433', fontSize: 20, fontWeight: '800' },
  button: { minHeight: 48, backgroundColor: '#FF6B2C', padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
