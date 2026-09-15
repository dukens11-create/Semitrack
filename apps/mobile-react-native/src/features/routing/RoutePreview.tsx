import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TruckRoute } from '../../models/contracts';
import {
  DriverCard,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from '../../components/DriverUI';
export function routeEstimate(route: TruckRoute, metric: boolean) {
  const minutes = Math.ceil(route.durationSeconds / 60);
  return {
    distance:
      (route.distanceMiles * (metric ? 1.609344 : 1)).toFixed(1) +
      (metric ? ' km' : ' mi'),
    duration:
      minutes >= 60
        ? Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
        : minutes + 'm',
  };
}
export function RoutePreview({
  route,
  metric,
}: {
  route: TruckRoute;
  metric: boolean;
}) {
  const p = useDriverPalette();
  const estimate = routeEstimate(route, metric);
  const calculated = Date.parse(route.calculatedAt);
  const arrival = Number.isFinite(calculated)
    ? new Date(calculated + route.durationSeconds * 1000).toLocaleTimeString(
        [],
        { hour: 'numeric', minute: '2-digit' },
      )
    : 'Unavailable';
  return (
    <DriverCard>
      <DriverTitle small>Truck route ready</DriverTitle>
      <View style={styles.stats}>
        {[
          { value: estimate.duration, label: 'Duration' },
          { value: estimate.distance, label: 'Distance' },
          { value: arrival, label: 'Estimated arrival' },
        ].map(item => (
          <View key={item.label} style={styles.stat}>
            <Text style={[styles.value, { color: p.text }]}>{item.value}</Text>
            <DriverCopy>{item.label}</DriverCopy>
          </View>
        ))}
      </View>
      <DriverCopy>
        Estimate calculated{' '}
        {Number.isFinite(calculated)
          ? new Date(calculated).toLocaleString()
          : 'at an unknown time'}
        . Arrival uses the device time zone. These are planning estimates, not
        live guidance.
      </DriverCopy>
      <DriverTitle small>Route Options</DriverTitle>
      <View
        accessibilityLabel="Selected Trimble truck route"
        style={styles.selected}
      >
        <Text style={styles.selectedTitle}>Selected truck route · Trimble</Text>
        <Text style={styles.selectedCopy}>
          {estimate.distance} · {estimate.duration}
        </Text>
      </View>
      <DriverCopy>
        Alternative route selection is unavailable. The current integration
        requests one validated truck route.
      </DriverCopy>
      {route.alerts.map((alert, index) => (
        <Text key={index} accessibilityRole="alert" style={styles.alert}>
          {alert}
        </Text>
      ))}
      <DriverTitle small>Route instructions</DriverTitle>
      <DriverCopy>Preview only — not live CoPilot maneuvers.</DriverCopy>
      {route.turnByTurn.map((step, index) => (
        <DriverCopy key={index}>
          {index + 1}. {step.instruction}
          {step.exitNumber ? ' · Exit ' + step.exitNumber : ''}
        </DriverCopy>
      ))}
    </DriverCard>
  );
}
const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexGrow: 1, minWidth: 88, gap: 4 },
  value: { fontSize: 20, fontWeight: '900' },
  selected: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    borderColor: '#1E88E5',
    borderWidth: 2,
    gap: 6,
  },
  selectedTitle: { color: '#1565C0', fontWeight: '800' },
  selectedCopy: { color: '#526273', fontSize: 12 },
  alert: { color: '#B42318', fontSize: 14, lineHeight: 20 },
});
