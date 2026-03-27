/**
 * NavigationScreen
 * Route calculation and turn-by-turn navigation UI.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import api from '../api/client';

const NavigationScreen = () => {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleCalculateRoute = async () => {
    if (!origin || !destination) {
      Alert.alert('Missing Info', 'Please enter both origin and destination.');
      return;
    }

    // For demo: parse "lat,lon" strings or use mock coordinates
    const parseCoords = (str) => {
      const parts = str.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return [parts[1], parts[0]]; // [lon, lat]
      }
      return null;
    };

    const originCoords = parseCoords(origin) || [-87.6298, 41.8781]; // Default: Chicago
    const destinationCoords = parseCoords(destination) || [-90.199, 38.627]; // Default: St. Louis

    setLoading(true);
    try {
      const { data } = await api.post('/navigation/route', {
        originCoords,
        destinationCoords,
        truckProfile: { avoidTolls },
      });
      setRoute(data);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to calculate route.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Navigation</Text>

      <Text style={styles.label}>Origin (lat, lon)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 41.8781, -87.6298"
        value={origin}
        onChangeText={setOrigin}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Destination (lat, lon)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 38.627, -90.199"
        value={destination}
        onChangeText={setDestination}
        keyboardType="decimal-pad"
      />

      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => setAvoidTolls(!avoidTolls)}
      >
        <View style={[styles.toggle, avoidTolls && styles.toggleActive]} />
        <Text style={styles.toggleLabel}>Avoid Tolls</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleCalculateRoute} disabled={loading}>
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Calculate Route</Text>}
      </TouchableOpacity>

      {route && (
        <View style={styles.routeCard}>
          <Text style={styles.routeTitle}>Route Summary</Text>
          <View style={styles.routeStat}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>{route.distanceKm} km</Text>
          </View>
          <View style={styles.routeStat}>
            <Text style={styles.statLabel}>Est. Duration</Text>
            <Text style={styles.statValue}>{route.durationMin} min</Text>
          </View>
          <View style={styles.routeStat}>
            <Text style={styles.statLabel}>Tolls</Text>
            <Text style={styles.statValue}>{route.avoidTolls ? 'Avoided' : 'Included'}</Text>
          </View>
          <Text style={styles.stepsTitle}>Steps</Text>
          {route.steps?.map((step, i) => (
            <Text key={i} style={styles.step}>{i + 1}. {step.instruction}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', marginBottom: 16 },
  label: { fontSize: 14, color: '#64748B', marginBottom: 4, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10,
    padding: 12, fontSize: 15, backgroundColor: '#FFFFFF',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  toggle: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#3B82F6', marginRight: 10 },
  toggleActive: { backgroundColor: '#3B82F6' },
  toggleLabel: { color: '#1E293B', fontSize: 15 },
  button: {
    backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 20,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  routeCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginTop: 20, elevation: 2 },
  routeTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B', marginBottom: 12 },
  routeStat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  statLabel: { color: '#64748B', fontSize: 14 },
  statValue: { color: '#1E293B', fontSize: 14, fontWeight: '600' },
  stepsTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginTop: 14, marginBottom: 6 },
  step: { color: '#475569', fontSize: 14, paddingVertical: 4 },
});

export default NavigationScreen;
