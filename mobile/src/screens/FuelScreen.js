/**
 * FuelScreen
 * Find diesel stations and log fuel fill-ups.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import api from '../api/client';

const FuelScreen = () => {
  const [tab, setTab] = useState('stations'); // 'stations' | 'fillup'
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lat, setLat] = useState('41.8781');
  const [lon, setLon] = useState('-87.6298');
  const [fillForm, setFillForm] = useState({
    truckId: '',
    litres: '',
    pricePerLitre: '',
    odometer: '',
    stationName: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const findStations = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/fuel/stations', { params: { lat, lon, radiusKm: 50, limit: 10 } });
      setStations(data);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to find stations.');
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  const handleFillUp = async () => {
    const { truckId, litres, pricePerLitre } = fillForm;
    if (!truckId || !litres || !pricePerLitre) {
      Alert.alert('Missing Info', 'Truck ID, litres, and price per litre are required.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/fuel/fillup', {
        truckId,
        litres: parseFloat(litres),
        pricePerLitre: parseFloat(pricePerLitre),
        odometer: fillForm.odometer ? parseFloat(fillForm.odometer) : undefined,
        stationName: fillForm.stationName || undefined,
      });
      Alert.alert('Logged!', `Filled ${data.litres}L for $${data.totalCost}`);
      setFillForm({ truckId: '', litres: '', pricePerLitre: '', odometer: '', stationName: '' });
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to log fill-up.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStation = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.stationName}>{item.name}</Text>
      <Text style={styles.stationAddress}>{item.address || 'Address not available'}</Text>
      {item.phone && <Text style={styles.stationPhone}>{item.phone}</Text>}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fuel Management</Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'stations' && styles.activeTab]} onPress={() => setTab('stations')}>
          <Text style={[styles.tabText, tab === 'stations' && styles.activeTabText]}>Find Stations</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'fillup' && styles.activeTab]} onPress={() => setTab('fillup')}>
          <Text style={[styles.tabText, tab === 'fillup' && styles.activeTabText]}>Log Fill-up</Text>
        </TouchableOpacity>
      </View>

      {tab === 'stations' && (
        <View style={styles.flex}>
          <View style={styles.searchBar}>
            <TextInput style={styles.coordInput} placeholder="Lat" value={lat} onChangeText={setLat} keyboardType="decimal-pad" />
            <TextInput style={styles.coordInput} placeholder="Lon" value={lon} onChangeText={setLon} keyboardType="decimal-pad" />
            <TouchableOpacity style={styles.searchButton} onPress={findStations}>
              <Text style={styles.searchButtonText}>Search</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator size="large" color="#3B82F6" style={styles.loader} />
          ) : (
            <FlatList
              data={stations}
              renderItem={renderStation}
              keyExtractor={(item) => item._id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Text style={styles.emptyText}>Search for fuel stations.</Text>}
            />
          )}
        </View>
      )}

      {tab === 'fillup' && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.formContent}>
          <TextInput style={styles.input} placeholder="Truck ID *" value={fillForm.truckId} onChangeText={(v) => setFillForm({ ...fillForm, truckId: v })} />
          <TextInput style={styles.input} placeholder="Litres filled *" value={fillForm.litres} onChangeText={(v) => setFillForm({ ...fillForm, litres: v })} keyboardType="decimal-pad" />
          <TextInput style={styles.input} placeholder="Price per litre * ($)" value={fillForm.pricePerLitre} onChangeText={(v) => setFillForm({ ...fillForm, pricePerLitre: v })} keyboardType="decimal-pad" />
          <TextInput style={styles.input} placeholder="Odometer (km)" value={fillForm.odometer} onChangeText={(v) => setFillForm({ ...fillForm, odometer: v })} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="Station name" value={fillForm.stationName} onChangeText={(v) => setFillForm({ ...fillForm, stationName: v })} />
          <TouchableOpacity style={styles.button} onPress={handleFillUp} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Log Fill-up</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: '#1E293B', padding: 16, paddingBottom: 8 },
  tabs: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#3B82F6' },
  tabText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  activeTabText: { color: '#3B82F6' },
  searchBar: { flexDirection: 'row', padding: 12, gap: 8, alignItems: 'center' },
  coordInput: { flex: 1, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 8, fontSize: 13, backgroundColor: '#FFF' },
  searchButton: { backgroundColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  searchButtonText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  loader: { marginTop: 40 },
  listContent: { paddingBottom: 20 },
  formContent: { padding: 16 },
  card: { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, elevation: 1 },
  stationName: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  stationAddress: { color: '#64748B', fontSize: 13, marginTop: 2 },
  stationPhone: { color: '#3B82F6', fontSize: 13, marginTop: 2 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14, backgroundColor: '#FFF' },
  button: { backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  emptyText: { textAlign: 'center', color: '#94A3B8', marginTop: 40, fontSize: 15 },
});

export default FuelScreen;
