/**
 * TruckDetailScreen
 * Shows detailed information for a single truck.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import api from '../api/client';

const STATUS_COLORS = {
  active: '#10B981',
  idle: '#F59E0B',
  maintenance: '#EF4444',
  offline: '#94A3B8',
};

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value ?? '—'}</Text>
  </View>
);

const TruckDetailScreen = ({ route, navigation }) => {
  const { truckId } = route.params;
  const [truck, setTruck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTruck = async () => {
      try {
        const { data } = await api.get(`/fleet/trucks/${truckId}`);
        setTruck(data);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    loadTruck();
  }, [truckId]);

  if (loading) return <ActivityIndicator size="large" color="#3B82F6" style={styles.center} />;
  if (error) return <Text style={[styles.center, styles.errorText]}>{error}</Text>;
  if (!truck) return null;

  const fuelPercent = truck.fuelCapacityL > 0
    ? Math.round((truck.currentFuelL / truck.fuelCapacityL) * 100)
    : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.truckId}>{truck.truckId}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[truck.status] || '#94A3B8' }]}>
          <Text style={styles.statusText}>{truck.status?.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vehicle Info</Text>
        <InfoRow label="License Plate" value={truck.licensePlate} />
        <InfoRow label="Make / Model" value={`${truck.make} ${truck.model} (${truck.year})`} />
        <InfoRow label="VIN" value={truck.vin} />
        <InfoRow label="Type" value={truck.type} />
        <InfoRow label="Max Payload" value={truck.maxPayloadKg ? `${truck.maxPayloadKg} kg` : null} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fuel</Text>
        <InfoRow label="Fuel Type" value={truck.fuelType} />
        <InfoRow label="Fuel Level" value={`${truck.currentFuelL} / ${truck.fuelCapacityL} L (${fuelPercent}%)`} />
        <View style={styles.fuelBar}>
          <View style={[styles.fuelFill, { width: `${fuelPercent}%`, backgroundColor: fuelPercent < 20 ? '#EF4444' : '#10B981' }]} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Driver</Text>
        <InfoRow label="Name" value={truck.assignedDriver?.name} />
        <InfoRow label="Email" value={truck.assignedDriver?.email} />
        <InfoRow label="Phone" value={truck.assignedDriver?.phone} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Maintenance</Text>
        <InfoRow label="Odometer" value={truck.odometer ? `${truck.odometer} km` : null} />
        <InfoRow label="Next Service" value={truck.nextServiceDueKm ? `${truck.nextServiceDueKm} km` : null} />
      </View>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => navigation.navigate('Navigation', { truckId })}
      >
        <Text style={styles.actionButtonText}>Start Navigation</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 80 },
  errorText: { color: '#EF4444', textAlign: 'center' },
  headerCard: {
    backgroundColor: '#1E293B',
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  truckId: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  statusText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  section: { backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 16, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  infoLabel: { color: '#64748B', fontSize: 14 },
  infoValue: { color: '#1E293B', fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  fuelBar: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  fuelFill: { height: '100%', borderRadius: 4 },
  actionButton: {
    margin: 16,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  actionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

export default TruckDetailScreen;
