import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { GuidanceDetails } from './navigationPresentation';
import { DriverCopy, useDriverPalette } from '../../components/DriverUI';
const arrows: Record<string, string> = {
  left: '←',
  right: '→',
  straight: '↑',
  continue: '↑',
  'slight left': '↖',
  'slight right': '↗',
  uturn: '↶',
};
export function LaneGuidance({ lanes }: { lanes: GuidanceDetails['lanes'] }) {
  const p = useDriverPalette();
  if (!lanes?.length) return null;
  return (
    <View testID="lane-guidance">
      <DriverCopy>Provider lane guidance</DriverCopy>
      <View style={styles.row}>
        {lanes.map((lane, index) => (
          <View
            key={index}
            accessible
            accessibilityLabel={
              'Lane ' +
              (index + 1) +
              ': ' +
              lane.directions.join(', ') +
              (lane.recommended ? ', recommended' : '')
            }
            style={[
              styles.lane,
              {
                borderColor: p.border,
                backgroundColor: p.input,
              },
              lane.recommended && styles.recommended,
            ]}
          >
            <Text style={[styles.arrow, { color: p.text }]}>
              {lane.directions.map(d => arrows[d.toLowerCase()] ?? d).join(' ')}
            </Text>
            {lane.recommended && <Text style={{ color: p.text }}>✓</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  recommended: { borderColor: '#14966F' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  lane: { borderWidth: 2, borderRadius: 6, padding: 6, alignItems: 'center' },
  arrow: { fontSize: 24, fontWeight: '700' },
});
