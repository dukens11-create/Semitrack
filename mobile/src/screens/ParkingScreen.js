/**
 * ParkingScreen
 * Find and reserve truck parking near current location.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import api from '../api/client';

const ParkingScreen = () => {
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lat, setLat] = useState('41.8781');
  const [lon, setLon] = useState('-87.6298');
  const [radius, setRadius] = useState('30');

  const findParking = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/parking/nearby', {
        params: { lat, lon, radiusKm: radius, limit: 15 },
      });
      setSpots(data);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to find parking.');
    } finally {
      setLoading(false);
    }
  }, [lat, lon, radius]);

  useEffect(() => { findParking(); }, [findParking]);

  const handleReserve = async (parkingId) => {
    Alert.prompt(
      'Reserve Spot',
      'Enter your Truck ID to reserve a spot:',
      async (truckId) => {
        if (!truckId) return;
        try {
          const now = new Date();
          const endTime = new Date(now.getTime() + 8 * 3600 * 1000); // 8 hrs default
          await api.post(`/parking/${parkingId}/reserve`, {
            truckId,
            startTime: now.toISOString(),
            endTime: endTime.toISOString(),
          });
          Alert.alert('Reserved!', 'Your spot has been reserved.');
          findParking();
        } catch (err) {
          Alert.alert('Error', err.response?.data?.error || 'Reservation failed.');
        }
      }
    );
  };

  const renderSpot = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={[styles.availability, { color: item.availableSpots > 0 ? '#10B981' : '#EF4444' }]}>
          {item.availableSpots}/{item.totalSpots} spots
        </Text>
      </View>
      <Text style={styles.address}>{item.address}</Text>
      {item.pricePerHour > 0 && <Text style={styles.price}>${item.pricePerHour}/hr · ${item.pricePerDay}/day</Text>}
      {item.amenities?.length > 0 && (
        <Text style={styles.amenities}>Amenities: {item.amenities.join(', ')}</Text>
      )}
      {item.availableSpots > 0 && (
        <TouchableOpacity style={styles.reserveButton} onPress={() => handleReserve(item._id)}>
          <Text style={styles.reserveButtonText}>Reserve Spot</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Find Parking</Text>

      <View style={styles.searchBar}>
        <TextInput style={styles.coordInput} placeholder="Lat" value={lat} onChangeText={setLat} keyboardType="decimal-pad" />
        <TextInput style={styles.coordInput} placeholder="Lon" value={lon} onChangeText={setLon} keyboardType="decimal-pad" />
        <TextInput style={styles.radiusInput} placeholder="Km" value={radius} onChangeText={setRadius} keyboardType="numeric" />
        <TouchableOpacity style={styles.searchButton} onPress={findParking}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3B82F6" style={styles.loader} />
      ) : (
        <FlatList
          data={spots}
          renderItem={renderSpot}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No parking found nearby.</Text>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', padding: 16, paddingBottom: 8 },
  searchBar: { flexDirection: 'row', padding: 12, gap: 6, alignItems: 'center' },
  coordInput: { flex: 2, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 8, fontSize: 13, backgroundColor: '#FFF' },
  radiusInput: { flex: 1, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 8, fontSize: 13, backgroundColor: '#FFF' },
  searchButton: { backgroundColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  searchButtonText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  loader: { marginTop: 40 },
  listContent: { paddingBottom: 20 },
  card: { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, elevation: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: '#1E293B', flex: 1, marginRight: 8 },
  availability: { fontSize: 14, fontWeight: '600' },
  address: { color: '#64748B', fontSize: 13, marginTop: 4 },
  price: { color: '#475569', fontSize: 13, marginTop: 2 },
  amenities: { color: '#94A3B8', fontSize: 12, marginTop: 4 },
  reserveButton: { backgroundColor: '#F59E0B', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 10 },
  reserveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  emptyText: { textAlign: 'center', color: '#94A3B8', marginTop: 40, fontSize: 15 },
});

export default ParkingScreen;
