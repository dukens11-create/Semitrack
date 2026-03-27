/**
 * HomeScreen
 * Dashboard overview: active truck, quick actions, and status cards.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import TruckList from '../components/TruckList';

const HomeScreen = ({ navigation }) => {
  const { user, logout } = useAuth();
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrucks = useCallback(async () => {
    try {
      const { data } = await api.get('/fleet');
      setTrucks(data.trucks || []);
    } catch (err) {
      console.error('Failed to load trucks:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTrucks();
  }, [loadTrucks]);

  const onRefresh = () => {
    setRefreshing(true);
    loadTrucks();
  };

  const quickActions = [
    { label: 'Navigate', screen: 'Navigation', color: '#3B82F6' },
    { label: 'Plan Trip', screen: 'TripPlanner', color: '#10B981' },
    { label: 'Find Parking', screen: 'Parking', color: '#F59E0B' },
    { label: 'Find Fuel', screen: 'Fuel', color: '#EF4444' },
    { label: 'Weather', screen: 'WeatherAlerts', color: '#8B5CF6' },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello, {user?.name || 'Driver'}!</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickActionsGrid}>
        {quickActions.map((action) => (
          <TouchableOpacity
            key={action.screen}
            style={[styles.quickActionCard, { backgroundColor: action.color }]}
            onPress={() => navigation.navigate(action.screen)}
          >
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Fleet</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#3B82F6" style={styles.loader} />
      ) : (
        <TruckList
          trucks={trucks}
          onTruckPress={(truck) => navigation.navigate('TruckDetail', { truckId: truck._id })}
        />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1E293B',
  },
  greeting: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  logoutText: { fontSize: 14, color: '#94A3B8' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', margin: 16, marginBottom: 8 },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
  },
  quickActionCard: {
    width: '30%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 13, textAlign: 'center' },
  loader: { marginTop: 40 },
});

export default HomeScreen;
