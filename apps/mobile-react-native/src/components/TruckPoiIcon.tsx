import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
export type TruckPoiIconName =
  | 'truck_stop_symbol'
  | 'weigh_station_symbol'
  | 'commercial_scale_symbol'
  | 'truck_wash_symbol'
  | 'truck_repair_symbol'
  | 'truck_parking_symbol';
/** Original geometric artwork; no provider brand or trademark assets. */
export function TruckPoiIcon({
  name,
  size,
  color,
}: {
  name: TruckPoiIconName;
  size: number;
  color: string;
}) {
  const u = size / 32,
    scale =
      name === 'weigh_station_symbol' || name === 'commercial_scale_symbol';
  const styles = StyleSheet.create({
    frame: { width: size, height: size },
    trailer: {
      position: 'absolute',
      left: 2 * u,
      top: 12 * u,
      width: 17 * u,
      height: 10 * u,
      borderRadius: 2 * u,
      backgroundColor: color,
    },
    cab: {
      position: 'absolute',
      left: 20 * u,
      top: 15 * u,
      width: 9 * u,
      height: 7 * u,
      borderTopRightRadius: 4 * u,
      backgroundColor: color,
    },
    wheel: {
      position: 'absolute',
      top: 22 * u,
      width: 4 * u,
      height: 4 * u,
      borderRadius: 2 * u,
      backgroundColor: color,
    },
    platform: {
      position: 'absolute',
      left: u,
      top: 27 * u,
      width: 30 * u,
      height: 2 * u,
      backgroundColor: color,
    },
    support: {
      position: 'absolute',
      top: 29 * u,
      width: 2 * u,
      height: 3 * u,
      backgroundColor: color,
    },
    badge: {
      position: 'absolute',
      top: -2 * u,
      left: 0,
      right: 0,
      textAlign: 'center',
      color,
      fontSize: (scale ? 10 : 13) * u,
      fontWeight: '900',
    },
    marker: {
      position: 'absolute',
      top: 0,
      left: 13 * u,
      width: 7 * u,
      height: 9 * u,
      borderRadius: 4 * u,
      borderWidth: 2 * u,
      borderColor: color,
    },
  });
  return (
    <View testID={name} accessible={false} style={styles.frame}>
      <View style={styles.trailer} />
      <View style={styles.cab} />
      {[6, 16, 25].map(x => (
        <View key={x} style={[styles.wheel, { left: (x - 2) * u }]} />
      ))}
      {scale ? (
        <>
          <View style={styles.platform} />
          <View style={[styles.support, { left: 6 * u }]} />
          <View style={[styles.support, { right: 6 * u }]} />
          <Text allowFontScaling={false} style={styles.badge}>
            {name === 'commercial_scale_symbol' ? '$' : '▰'}
          </Text>
        </>
      ) : name === 'truck_stop_symbol' ? (
        <View style={styles.marker} />
      ) : (
        <Text allowFontScaling={false} style={styles.badge}>
          {name === 'truck_parking_symbol'
            ? 'P'
            : name === 'truck_wash_symbol'
            ? '≋'
            : '⚒'}
        </Text>
      )}
    </View>
  );
}
