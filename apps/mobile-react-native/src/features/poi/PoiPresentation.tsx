import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { DriverIconName } from '../../components/DriverIcon';
import type { PlaceCategory, Poi } from './PoiService';
export const placeShortcuts: {
  label: string;
  category: PlaceCategory;
  icon: DriverIconName;
  color: string;
}[] = [
  {
    label: 'Truck Stops',
    category: 'truck_stop',
    icon: 'restaurant_rounded',
    color: '#E8583E',
  },
  {
    label: 'Weigh Stations',
    category: 'weigh_station',
    icon: 'scale_rounded',
    color: '#008F7D',
  },
  {
    label: 'Parking',
    category: 'truck_parking',
    icon: 'local_parking_rounded',
    color: '#0B68E8',
  },
  {
    label: 'Truck Fuel',
    category: 'fuel_stop',
    icon: 'local_gas_station_rounded',
    color: '#FF8A00',
  },
  {
    label: 'Rest Areas',
    category: 'rest_area',
    icon: 'park_rounded',
    color: '#0A9FC1',
  },
  {
    label: 'Walmarts',
    category: 'walmart_store',
    icon: 'storefront_rounded',
    color: '#146DE0',
  },
  {
    label: 'Truck Washes',
    category: 'truck_wash',
    icon: 'local_car_wash_rounded',
    color: '#008F7D',
  },
];
const logos = {
  pilot: require('../../assets/original/logo_brand_markers/pilot.png'),
  loves: require('../../assets/original/logo_brand_markers/loves.png'),
  flyingj: require('../../assets/original/logo_brand_markers/flying_j_truck_stop.png'),
  ta: require('../../assets/original/logo_brand_markers/ta_truck_stop.png'),
  petro: require('../../assets/original/logo_brand_markers/petro_truck_stop.png'),
  truck_stop: require('../../assets/original/logo_brand_markers/truck_stop_default.png'),
  weigh_station: require('../../assets/original/logo_brand_markers/weight_station.png'),
  rest_area: require('../../assets/original/logo_brand_markers/rest_area.png'),
  truck_parking: require('../../assets/original/logo_brand_markers/truck_parking.png'),
  walmart_store: require('../../assets/original/logo_brand_markers/walmart_store.png'),
  truck_wash: require('../../assets/original/logo_brand_markers/commercial_vehicle_wash.png'),
};
function logo(poi: Poi) {
  const name = poi.name.toLowerCase();
  if (/\bpilot\b/.test(name)) return logos.pilot;
  if (/\blove['’]?s\b/.test(name)) return logos.loves;
  if (/\bflying j\b/.test(name)) return logos.flyingj;
  if (/\bpetro\b/.test(name)) return logos.petro;
  if (/\bta\b|travelcenters of america/.test(name)) return logos.ta;
  return logos[poi.category as keyof typeof logos] || logos.truck_stop;
}
export function PoiArtwork({ poi, pin = false }: { poi: Poi; pin?: boolean }) {
  return (
    <View accessibilityLabel={poi.name} style={pin ? styles.pin : styles.disc}>
      {pin && <View style={styles.tail} />}
      <Image source={logo(poi)} resizeMode="contain" style={styles.image} />
    </View>
  );
}
// A grey outline deliberately does not claim a verified truck entrance.
const styles = StyleSheet.create({
  disc: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
    padding: 4,
  },
  pin: {
    width: 50,
    height: 58,
    padding: 5,
    borderRadius: 25,
    backgroundColor: 'white',
    borderWidth: 3,
    borderColor: '#637080',
    alignItems: 'center',
  },
  image: { width: 40, height: 40 },
  tail: {
    position: 'absolute',
    bottom: -4,
    width: 12,
    height: 12,
    backgroundColor: '#637080',
    transform: [{ rotate: '45deg' }],
  },
});
