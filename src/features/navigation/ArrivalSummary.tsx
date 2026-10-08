import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverTitle,
} from '../../components/DriverUI';
import { DriverIcon } from '../../components/DriverIcon';
import type { StopPlan } from '../stops/StopPlan';
import type { TruckRoute } from '../../models/contracts';
import { routeEstimate } from '../routing/RoutePreview';

export function ArrivalSummary({
  route,
  plan,
  metric,
  busy = false,
  onDone,
}: {
  route: TruckRoute;
  plan: StopPlan;
  metric: boolean;
  busy?: boolean;
  onDone: () => void;
}) {
  const estimate = routeEstimate(route, metric);

  return (
    <>
      <DriverCard>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <DriverIcon name="verified_user_rounded" size={58} color="#14966F" />
          </View>
          <DriverTitle>Trip Complete</DriverTitle>
          <DriverCopy>
            {'Provider navigation reported arrival at ' + plan.destination.name + '.'}
          </DriverCopy>
        </View>
      </DriverCard>

      <DriverCard>
        <DriverTitle small>Completed route summary</DriverTitle>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <DriverTitle small>{estimate.distance}</DriverTitle>
            <DriverCopy>Planned distance</DriverCopy>
          </View>
          <View style={styles.stat}>
            <DriverTitle small>{estimate.duration}</DriverTitle>
            <DriverCopy>Planned route time</DriverCopy>
          </View>
        </View>
        <DriverCopy>
          These values come from the accepted Trimble route plan. SemiTraX does
          not label them as actual driven distance or actual trip time unless a
          verified provider reports those measurements.
        </DriverCopy>
      </DriverCard>

      <DriverButton
        title="Done - Clear Completed Route"
        disabled={busy}
        onPress={onDone}
      />
      <DriverCopy>
        Done clears only the completed route and returns the map to planning
        mode. Your selected truck profile, account and current GPS remain.
      </DriverCopy>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  iconWrap: { paddingBottom: 2 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, gap: 4, paddingVertical: 4 },
});
