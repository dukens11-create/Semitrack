/**
 * WeatherAlertsScreen
 * Current weather conditions and driving safety alerts.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import api from '../api/client';

const SEVERITY_COLORS = { high: '#EF4444', moderate: '#F59E0B', low: '#10B981' };
const SEVERITY_ICONS = { high: '🚨', moderate: '⚠️', low: 'ℹ️' };

const WeatherAlertsScreen = () => {
  const [lat, setLat] = useState('41.8781');
  const [lon, setLon] = useState('-87.6298');
  const [weather, setWeather] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/weather/current', { params: { lat, lon } });
      setWeather(data);

      // Also fetch alerts for the current coordinate
      const alertsRes = await api.post('/weather/alerts', {
        coordinates: [[parseFloat(lon), parseFloat(lat)]],
      });
      setAlerts(alertsRes.data || []);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to fetch weather.');
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  const renderAlert = ({ item }) => (
    <View style={[styles.alertCard, { borderLeftColor: SEVERITY_COLORS[item.severity] || '#94A3B8' }]}>
      <Text style={styles.alertIcon}>{SEVERITY_ICONS[item.severity] || 'ℹ️'}</Text>
      <View style={styles.alertBody}>
        <Text style={styles.alertType}>{item.type}</Text>
        <Text style={styles.alertMessage}>{item.message}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Weather Alerts</Text>

      <View style={styles.searchBar}>
        <TextInput style={styles.coordInput} placeholder="Lat" value={lat} onChangeText={setLat} keyboardType="decimal-pad" />
        <TextInput style={styles.coordInput} placeholder="Lon" value={lon} onChangeText={setLon} keyboardType="decimal-pad" />
        <TouchableOpacity style={styles.searchButton} onPress={fetchWeather} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.searchButtonText}>Check</Text>}
        </TouchableOpacity>
      </View>

      {weather && (
        <View style={styles.weatherCard}>
          <Text style={styles.weatherCondition}>
            {weather.weather?.[0]?.description || weather.condition || 'Unknown'}
          </Text>
          <View style={styles.weatherStats}>
            <View style={styles.weatherStat}>
              <Text style={styles.weatherStatValue}>{weather.main?.temp ?? '—'}°C</Text>
              <Text style={styles.weatherStatLabel}>Temperature</Text>
            </View>
            <View style={styles.weatherStat}>
              <Text style={styles.weatherStatValue}>{weather.main?.humidity ?? '—'}%</Text>
              <Text style={styles.weatherStatLabel}>Humidity</Text>
            </View>
            <View style={styles.weatherStat}>
              <Text style={styles.weatherStatValue}>{weather.wind?.speed ?? '—'} m/s</Text>
              <Text style={styles.weatherStatLabel}>Wind</Text>
            </View>
          </View>
          {weather.mock && <Text style={styles.mockNote}>Mock data — configure WEATHER_API_KEY for live data.</Text>}
        </View>
      )}

      {alerts.length > 0 && (
        <>
          <Text style={styles.alertsTitle}>Driving Alerts ({alerts.length})</Text>
          <FlatList
            data={alerts}
            renderItem={renderAlert}
            keyExtractor={(_, i) => String(i)}
            scrollEnabled={false}
          />
        </>
      )}

      {alerts.length === 0 && weather && (
        <View style={styles.safeCard}>
          <Text style={styles.safeText}>✅ No driving alerts. Conditions look safe.</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', marginBottom: 16 },
  searchBar: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  coordInput: { flex: 1, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#FFF' },
  searchButton: { backgroundColor: '#8B5CF6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  searchButtonText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  weatherCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 16 },
  weatherCondition: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 16, textTransform: 'capitalize' },
  weatherStats: { flexDirection: 'row', justifyContent: 'space-around' },
  weatherStat: { alignItems: 'center' },
  weatherStatValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  weatherStatLabel: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  mockNote: { color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 12 },
  alertsTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 8 },
  alertCard: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14,
    marginBottom: 8, flexDirection: 'row', borderLeftWidth: 4, elevation: 1,
  },
  alertIcon: { fontSize: 22, marginRight: 12 },
  alertBody: { flex: 1 },
  alertType: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  alertMessage: { color: '#64748B', fontSize: 13, marginTop: 2 },
  safeCard: { backgroundColor: '#D1FAE5', borderRadius: 12, padding: 16, alignItems: 'center' },
  safeText: { color: '#065F46', fontSize: 15, fontWeight: '600' },
});

export default WeatherAlertsScreen;
