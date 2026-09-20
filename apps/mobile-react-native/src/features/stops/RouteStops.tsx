import { MAX_INTERMEDIATE_STOPS } from '../../models/routeLimits';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DriverCard,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from '../../components/DriverUI';
import type { Stop, StopPlan } from './StopPlan';

export function RouteStops({
  plan,
  disabled,
  onView,
  onRemove,
  onReorder,
}: {
  plan: StopPlan;
  disabled: boolean;
  onView: (stop: Stop) => void;
  onRemove: (stop: Stop) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const palette = useDriverPalette();
  const ordered = [...plan.stops, plan.destination];
  function action(
    label: string,
    text: string,
    onPress: () => void,
    unavailable = false,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: unavailable }}
        disabled={unavailable}
        onPress={onPress}
        style={[styles.action, unavailable && styles.disabled]}
      >
        <Text style={[styles.actionText, { color: palette.text }]}>{text}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.list}>
      <DriverCopy>
        Origin · Current location. Stops are visited in the order below.
      </DriverCopy>
      {plan.stops.length >= MAX_INTERMEDIATE_STOPS && (
        <DriverCopy>{`Maximum ${MAX_INTERMEDIATE_STOPS} intermediate stops reached. Remove a stop to add another.`}</DriverCopy>
      )}
      {ordered.map((stop, index) => (
        <DriverCard key={stop.id}>
          <DriverCopy>
            {'Stop ' +
              (index + 1) +
              (index === ordered.length - 1 ? ' · Final destination' : '')}
          </DriverCopy>
          <DriverTitle small>{stop.name}</DriverTitle>
          <View style={styles.actions}>
            {action('View stop ' + (index + 1), 'View', () => onView(stop))}
            {action(
              'Remove stop ' + (index + 1),
              'Remove',
              () => onRemove(stop),
              disabled || ordered.length === 1,
            )}
            {index > 0 &&
              action(
                'Move stop ' + (index + 1) + ' earlier',
                '↑ Earlier',
                () => onReorder(index, index - 1),
                disabled,
              )}
            {index < ordered.length - 1 &&
              action(
                'Move stop ' + (index + 1) + ' later',
                '↓ Later',
                () => onReorder(index, index + 1),
                disabled,
              )}
          </View>
        </DriverCard>
      ))}
      {ordered.length === 1 && (
        <DriverCopy>
          Keep a destination on your route. Use Cancel Route to clear the whole
          route.
        </DriverCopy>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  list: { gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  action: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  actionText: { fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
