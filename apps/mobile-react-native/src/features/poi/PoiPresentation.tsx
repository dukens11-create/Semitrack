import { stationBrandId, stationBrandPictures } from './stationBrandPictures';
import { useDriverPalette } from '../../components/DriverUI';
import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { DriverIcon, type DriverIconName } from '../../components/DriverIcon';
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
    icon: 'truck_stop_symbol',
    color: '#E8583E',
  },
  {
    label: 'Weigh Stations',
    category: 'weigh_station',
    icon: 'weigh_station_symbol',
    color: '#008F7D',
  },
  {
    label: 'Parking',
    category: 'truck_parking',
    icon: 'truck_parking_symbol',
    color: '#0B68E8',
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
    icon: 'truck_wash_symbol',
    color: '#008F7D',
  },
  {
    label: 'Truck Repair',
    category: 'truck_repair',
    icon: 'truck_repair_symbol',
    color: '#7189AC',
  },
];
export function poiIcon(category?: string): DriverIconName {
  return (
    placeShortcuts.find(item => item.category === category)?.icon ??
    (category === 'cat_scale'
      ? 'commercial_scale_symbol'
      : category === 'fuel_stop'
      ? 'truck_stop_symbol'
      : category === 'restaurant'
      ? 'restaurant_rounded'
      : 'add_location')
  );
}
// User-supplied category artwork; a picture never establishes provider availability.
export const poiPictures: Record<PlaceCategory, ImageSourcePropType> = {
  truck_stop: require('../../assets/poi-pictures/truck-stop.png'),
  weigh_station: require('../../assets/poi-pictures/weigh-station.png'),
  cat_scale: require('../../assets/poi-pictures/cat-scale.png'),
  fuel_stop: require('../../assets/poi-pictures/truck-stop.png'),
  truck_wash: require('../../assets/poi-pictures/truck-wash.png'),
  truck_repair: require('../../assets/poi-pictures/truck-repair.png'),
  truck_parking: require('../../assets/poi-pictures/truck-parking.png'),
  rest_area: require('../../assets/poi-pictures/rest-area.png'),
  walmart_store: require('../../assets/poi-pictures/retail.png'),
};
export function PoiCategoryPicture({
  category,
  size = 40,
}: {
  category?: string;
  size?: number;
}) {
  const p = useDriverPalette();
  const source =
    category && Object.prototype.hasOwnProperty.call(poiPictures, category)
      ? poiPictures[category as PlaceCategory]
      : undefined;
  return source ? (
    <View
      style={[
        styles.categoryFrame,
        { width: size, height: size, borderRadius: size * 0.24 },
      ]}
    >
      <Image
        testID={'poi-picture-' + category}
        source={source}
        accessible={false}
        importantForAccessibility="no"
        resizeMode="cover"
        style={{ width: size, height: size }}
      />
    </View>
  ) : (
    <DriverIcon
      name={poiIcon(category)}
      size={size * 0.8}
      color={p.dark ? '#FFC08B' : '#235577'}
    />
  );
}
export function PoiArtwork({ poi, pin = false }: { poi: Poi; pin?: boolean }) {
  const p = useDriverPalette();
  const brand = stationBrandId(poi);
  return (
    <View
      accessibilityLabel={poi.name}
      style={[
        pin ? styles.pin : styles.disc,
        { backgroundColor: p.card, borderColor: p.border },
      ]}
    >
      {pin && <View style={styles.tail} />}
      {brand ? (
        <View style={styles.logoFrame}>
          <Image
            testID={'station-logo-' + brand}
            source={stationBrandPictures[brand]}
            accessible={false}
            importantForAccessibility="no"
            resizeMode="contain"
            style={styles.image}
          />
        </View>
      ) : (
        <PoiCategoryPicture
          category={
            poi.category === 'gas_station' ? 'truck_stop' : poi.category
          }
          size={40}
        />
      )}
    </View>
  );
}
// A grey outline deliberately does not claim a verified truck entrance.
const styles = StyleSheet.create({
  categoryFrame: { overflow: 'hidden' },
  disc: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {
    width: 50,
    height: 58,
    padding: 2,
    borderRadius: 25,
    backgroundColor: 'white',
    borderWidth: 3,
    borderColor: '#637080',
    alignItems: 'center',
  },
  logoFrame: {
    width: 40,
    height: 40,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: 'white',
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

export function poiDetails(poi: Poi): string {
  const parts = [
    poi.address,
    poi.provider ? 'Source: ' + poi.provider : 'Source unknown',
  ];
  if (poi.distanceMeters !== undefined)
    parts.push(
      (poi.distanceMeters / 1609.344).toFixed(1) + ' mi straight-line distance',
    );
  if (poi.routeDistanceAheadMeters !== undefined)
    parts.push(
      (poi.routeDistanceAheadMeters / 1609.344).toFixed(1) +
        ' mi ahead on planned route; access detour not included',
    );
  if (typeof poi.reportedCashPrice === 'number')
    parts.push(
      'Reported diesel cash price USD/US gallon ' +
        poi.reportedCashPrice.toFixed(3) +
        ' · ' +
        String(poi.priceSource) +
        ' · ' +
        String(poi.priceObservedAt),
    );
  if (poi.category === 'weigh_station') {
    parts.push(
      'Weigh station status: UNKNOWN unless a current sourced station report is shown in Road and truck services',
    );
    if (typeof poi.direction === 'string')
      parts.push('Direction: ' + poi.direction);
  }
  parts.push('Truck entrance, opening status and availability unverified');
  return parts.filter(Boolean).join(' · ');
}
