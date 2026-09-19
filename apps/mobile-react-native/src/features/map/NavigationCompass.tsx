import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useDriverPalette } from '../../components/DriverUI';
export function compassRotation(bearing: number | null) {
  return bearing !== null && Number.isFinite(bearing)
    ? -(((bearing % 360) + 360) % 360)
    : null;
}
export function NavigationCompass({ bearing }: { bearing: number | null }) {
  const p = useDriverPalette(),
    angle = compassRotation(bearing);
  if (angle === null)
    return (
      <Text
        accessibilityLabel="Map bearing unavailable"
        style={{ color: p.muted }}
      >
        —
      </Text>
    );
  return (
    <View
      testID="compass-needle"
      accessibilityLabel={
        'Map bearing ' + Math.round(((bearing! % 360) + 360) % 360) + ' degrees'
      }
      style={[styles.face, { transform: [{ rotate: angle + 'deg' }] }]}
    >
      <Text style={styles.north}>N</Text>
      <View style={styles.northTip} />
      <View style={[styles.southTip, { borderTopColor: p.muted }]} />
      <Text style={[styles.south, { color: p.text }]}>S</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    width: 40,
  },
  north: { color: '#E45438', fontSize: 10, fontWeight: '900', lineHeight: 11 },
  south: { fontSize: 10, fontWeight: '800', lineHeight: 11 },
  northTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#E45438',
  },
  southTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
