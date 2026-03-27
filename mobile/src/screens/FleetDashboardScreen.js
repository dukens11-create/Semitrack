/**
 * FleetDashboardScreen
 * Fleet management overview for dispatchers and managers.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import api from '../api/client';

const STATUS_COLORS = {
  active: '#10B981',
  idle: '#F59E0B',
  maintenance: '#EF4444',
  offline: '#94A3B8',
};

const StatCard = ({ label, value, color }) => (
  <View style={[styles.statCard, { borderLeftColor: color }]}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const FleetDashboardScreen = ({ navigation }) => {
  const [overview, setOverview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [fleetRes, analyticsRes] = await Promise.all([
        api.get('/fleet'),
        api.get('/fleet/analytics'),
      ]);
      setOverview(fleetRes.data);
      setAnalytics(analyticsRes.data);
    } catch (err) {
      console.error('Failed to load fleet data:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const renderTruck = ({ item }) => (
    <TouchableOpacity
      style={styles.truckCard}
      onPress={() => navigation.navigate('TruckDetail', { truckId: item._id })}
    >
      <View style={styles.truckCardLeft}>
        <Text style={styles.truckId}>{item.truckId}</Text>
        <Text style={styles.truckInfo}>{item.make} {item.model} · {item.licensePlate}</Text>
        {item.assignedDriver && <Text style={styles.driverName}>Driver: {item.assignedDriver.name}</Text>}
      </View>
      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] || '#94A3B8' }]} />
    </TouchableOpacity>
  );

  if (loading) return <ActivityIndicator size="large" color="#3B82F6" style={styles.center} />;

  const summary = overview?.summary || {};
  const tripStats = analytics?.tripStats || {};

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Fleet Dashboard</Text>

      <Text style={styles.sectionTitle}>Fleet Status</Text>
      <View style={styles.statsRow}>
        <StatCard label="Total" value={summary.total || 0} color="#3B82F6" />
        <StatCard label="Active" value={summary.active || 0} color="#10B981" />
        <StatCard label="Idle" value={summary.idle || 0} color="#F59E0B" />
        <StatCard label="Maint." value={summary.maintenance || 0} color="#EF4444" />
      </View>

      <Text style={styles.sectionTitle}>Trip Analytics</Text>
      <View style={styles.analyticsCard}>
        <View style={styles.analyticRow}>
          <Text style={styles.analyticLabel}>Total Trips</Text>
          <Text style={styles.analyticValue}>{tripStats.totalTrips || 0}</Text>
        </View>
        <View style={styles.analyticRow}>
          <Text style={styles.analyticLabel}>Total Distance</Text>
          <Text style={styles.analyticValue}>{(tripStats.totalDistanceKm || 0).toFixed(0)} km</Text>
        </View>
        <View style={styles.analyticRow}>
          <Text style={styles.analyticLabel}>Total Fuel Used</Text>
          <Text style={styles.analyticValue}>{(tripStats.totalFuelL || 0).toFixed(0)} L</Text>
        </View>
        <View style={styles.analyticRow}>
          <Text style={styles.analyticLabel}>Avg. Trip Duration</Text>
          <Text style={styles.analyticValue}>{(tripStats.avgDurationMin || 0).toFixed(0)} min</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>All Trucks ({overview?.trucks?.length || 0})</Text>
      <FlatList
        data={overview?.trucks || []}
        renderItem={renderTruck}
        keyExtractor={(item) => item._id}
        scrollEnabled={false}
        ListEmptyComponent={<Text style={styles.emptyText}>No trucks found.</Text>}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, marginTop: 80 },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 8, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12,
    borderLeftWidth: 4, elevation: 1, alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '700', color: '#1E293B' },
  statLabel: { fontSize: 12, color: '#64748B', marginTop: 2 },
  analyticsCard: { backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 16, elevation: 1 },
  analyticRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  analyticLabel: { color: '#64748B', fontSize: 14 },
  analyticValue: { color: '#1E293B', fontSize: 14, fontWeight: '600' },
  truckCard: {
    backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, padding: 14, elevation: 1,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  truckCardLeft: { flex: 1 },
  truckId: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  truckInfo: { color: '#64748B', fontSize: 13, marginTop: 2 },
  driverName: { color: '#3B82F6', fontSize: 12, marginTop: 2 },
  statusDot: { width: 14, height: 14, borderRadius: 7, marginLeft: 8 },
  emptyText: { textAlign: 'center', color: '#94A3B8', marginTop: 20, fontSize: 15, marginBottom: 20 },
});

export default FleetDashboardScreen;
