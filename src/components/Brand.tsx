import React from 'react';
import { Image, StyleSheet } from 'react-native';
export function Brand() {
  return (
    <Image
      accessibilityLabel="SemiTraX — Smarter routes. Safer deliveries."
      source={require('../assets/semitrax_brand_lockup.png')}
      resizeMode="contain"
      style={styles.logo}
    />
  );
}
const styles = StyleSheet.create({
  logo: {
    width: '100%',
    height: 170,
    backgroundColor: '#000',
    borderRadius: 12,
  },
});
