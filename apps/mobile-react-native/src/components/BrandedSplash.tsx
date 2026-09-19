import { useDriverPalette } from './DriverUI';
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

export function BrandedSplash() {
  const p = useDriverPalette();
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <View
      style={[styles.fill, { backgroundColor: p.canvas }]}
      accessibilityLabel="SemiTraX is loading"
      accessibilityState={{ busy: true }}
    >
      <Image
        accessible={false}
        source={
          imageFailed
            ? require('../assets/semitrax_brand_lockup.png')
            : require('../assets/semitrax_splash.png')
        }
        resizeMode="contain"
        style={styles.fallback}
        onError={() => setImageFailed(true)}
      />
      <ActivityIndicator
        accessibilityLabel="Restoring your session"
        color="#FF6B2C"
        style={styles.progress}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: { width: '90%', maxWidth: 360, aspectRatio: 1146 / 840 },
  progress: { position: 'absolute', bottom: 28 },
});
