/**
 * TripPlannerScreen
 * Plan, view, and manage trips.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import api from '../api/client';

const STATUS_COLORS = { planned: '#3B82F6', in_progress: '#10B981', completed: '#94A3B8', cancelled: '#EF4444' };

const TripPlannerScreen = () => {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    truckId: '',
    originAddress: '',
    destinationAddress: '',
    cargoDescription: '',
    cargoWeightKg: '',
  });

  const loadTrips = useCallback(async () => {
    try {
      const { data } = await api.get('/trips');
      setTrips(data);
    } catch (err) {
      console.error('Failed to load trips:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  const handleCreateTrip = async () => {
    if (!form.truckId || !form.originAddress || !form.destinationAddress) {
      Alert.alert('Missing Info', 'Truck ID, origin, and destination are required.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/trips', {
        truckId: form.truckId,
        origin: { address: form.originAddress, coordinates: [-87.6298, 41.8781] },
        destination: { address: form.destinationAddress, coordinates: [-90.199, 38.627] },
        cargoDescription: form.cargoDescription,
        cargoWeightKg: form.cargoWeightKg ? parseFloat(form.cargoWeightKg) : undefined,
      });
      setForm({ truckId: '', originAddress: '', destinationAddress: '', cargoDescription: '', cargoWeightKg: '' });
      loadTrips();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to create trip.');
    } finally {
      setCreating(false);
    }
  };

  const renderTrip = ({ item }) => (
    <View style={styles.tripCard}>
      <View style={styles.tripHeader}>
        <Text style={styles.tripRoute} numberOfLines={1}>{item.origin?.address} → {item.destination?.address}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || '#94A3B8' }]}>
          <Text style={styles.statusText}>{item.status?.replace('_', ' ').toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.tripMeta}>
        {item.distanceKm ? `${item.distanceKm} km` : 'Distance N/A'}
        {item.estimatedDuration ? `  ·  ~${item.estimatedDuration} min` : ''}
      </Text>
      {item.cargoDescription ? <Text style={styles.tripMeta}>Cargo: {item.cargoDescription}</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trip Planner</Text>

      <View style={styles.formCard}>
        <TextInput style={styles.input} placeholder="Truck ID" value={form.truckId} onChangeText={(v) => setForm({ ...form, truckId: v })} />
        <TextInput style={styles.input} placeholder="Origin Address" value={form.originAddress} onChangeText={(v) => setForm({ ...form, originAddress: v })} />
        <TextInput style={styles.input} placeholder="Destination Address" value={form.destinationAddress} onChangeText={(v) => setForm({ ...form, destinationAddress: v })} />
        <TextInput style={styles.input} placeholder="Cargo Description (optional)" value={form.cargoDescription} onChangeText={(v) => setForm({ ...form, cargoDescription: v })} />
        <TextInput style={styles.input} placeholder="Cargo Weight (kg)" value={form.cargoWeightKg} onChangeText={(v) => setForm({ ...form, cargoWeightKg: v })} keyboardType="numeric" />
        <TouchableOpacity style={styles.button} onPress={handleCreateTrip} disabled={creating}>
          {creating ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Plan Trip</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>My Trips</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#3B82F6" style={styles.loader} />
      ) : (
        <FlatList
          data={trips}
          renderItem={renderTrip}
          keyExtractor={(item) => item._id}
          ListEmptyComponent={<Text style={styles.emptyText}>No trips found.</Text>}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', padding: 16, paddingBottom: 8 },
  formCard: { backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 16, elevation: 2 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 },
  button: { backgroundColor: '#3B82F6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginHorizontal: 16, marginTop: 8, marginBottom: 4 },
  loader: { marginTop: 40 },
  listContent: { paddingBottom: 20 },
  tripCard: { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, elevation: 1 },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  tripRoute: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E293B', marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  statusText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  tripMeta: { color: '#64748B', fontSize: 13, marginTop: 2 },
  emptyText: { textAlign: 'center', color: '#94A3B8', marginTop: 40, fontSize: 15 },
});

export default TripPlannerScreen;
