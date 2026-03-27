/**
 * TruckList component
 * Renders a scrollable list of trucks with status indicators.
 */
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';

const STATUS_COLORS = {
  active: '#10B981',
  idle: '#F59E0B',
  maintenance: '#EF4444',
  offline: '#94A3B8',
};

const TruckItem = ({ truck, onPress }) => (
  <TouchableOpacity style={styles.card} onPress={() => onPress(truck)} activeOpacity={0.8}>
    <View style={styles.left}>
      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[truck.status] || '#CBD5E1' }]} />
      <View style={styles.info}>
        <Text style={styles.truckId}>{truck.truckId}</Text>
        <Text style={styles.truckMeta}>{truck.make} {truck.model} · {truck.licensePlate}</Text>
        {truck.assignedDriver && (
          <Text style={styles.driverText}>Driver: {truck.assignedDriver.name || truck.assignedDriver}</Text>
        )}
      </View>
    </View>
    <View style={styles.right}>
      <Text style={[styles.statusLabel, { color: STATUS_COLORS[truck.status] || '#94A3B8' }]}>
        {truck.status?.toUpperCase()}
      </Text>
      {truck.currentFuelL !== undefined && truck.fuelCapacityL > 0 && (
        <Text style={styles.fuelText}>
          ⛽ {Math.round((truck.currentFuelL / truck.fuelCapacityL) * 100)}%
        </Text>
      )}
    </View>
  </TouchableOpacity>
);

const TruckList = ({ trucks = [], onTruckPress }) => {
  if (trucks.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No trucks available.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={trucks}
      renderItem={({ item }) => <TruckItem truck={item} onPress={onTruckPress} />}
      keyExtractor={(item) => item._id || item.truckId}
      contentContainerStyle={styles.listContent}
      scrollEnabled={false}
    />
  );
};

const styles = StyleSheet.create({
  listContent: { paddingBottom: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  info: { flex: 1 },
  truckId: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  truckMeta: { fontSize: 13, color: '#64748B', marginTop: 2 },
  driverText: { fontSize: 12, color: '#3B82F6', marginTop: 2 },
  right: { alignItems: 'flex-end' },
  statusLabel: { fontSize: 11, fontWeight: '700' },
  fuelText: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#94A3B8', fontSize: 15 },
});

export default TruckList;
