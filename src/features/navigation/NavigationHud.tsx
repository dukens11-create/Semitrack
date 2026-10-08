import {routeDisplayProgress} from './routeDisplayProgress';
import { LaneGuidance } from './LaneGuidance';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from '../../components/DriverUI';
import type { TruckRoute } from '../../models/contracts';
import type { NavigationState } from '../../services/guidance/NavigationEngine';
import type { LocationFix } from '../../services/location/LocationService';
import { distanceText, navigationPresentation } from './navigationPresentation';
export function NavigationHud({
  route,
  state,
  fix,
  metric = false,
}: {
  route: TruckRoute | null;
  state: NavigationState;
  fix: LocationFix | null;
  metric?: boolean;
}) {
  const p = useDriverPalette();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!route) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [route]);
  const data = navigationPresentation(route, state, fix);
  if (!data || !route) return null;
  const g = data.guidance;
  const progress=g?.maneuverMeters!==undefined?routeDisplayProgress(route,state.maneuverOffset):null;
  return (
    <View
      testID="navigation-hud"
      style={[styles.card, { backgroundColor: p.card }]}
    >
      <DriverTitle small>
        {data.mode === 'preview'
          ? 'Route preview · Trimble estimate'
          : 'Navigation · ' + data.mode}
      </DriverTitle>
      {data.mode === 'preview' ? (
        <>
          <DriverCopy>
            {distanceText(route.distanceMiles * 1609.344, metric)} ·{' '}
            {Math.ceil(route.durationSeconds / 60)} min · Guidance has not started
          </DriverCopy>
          {route.turnByTurn[0] && (
            <>
              <DriverCopy>{`Next preview maneuver: ${route.turnByTurn[0].instruction} · ${distanceText(
                route.turnByTurn[0].distanceMiles * 1609.344,
                metric,
              )}`}</DriverCopy>
              {[
                route.turnByTurn[0].currentRoadName &&
                  'Current road: ' + route.turnByTurn[0].currentRoadName,
                (route.turnByTurn[0].nextRoadName ?? route.turnByTurn[0].roadName) &&
                  'Next road: ' +
                    (route.turnByTurn[0].nextRoadName ?? route.turnByTurn[0].roadName),
                route.turnByTurn[0].exitNumber &&
                  'Exit ' + route.turnByTurn[0].exitNumber,
              ].filter(Boolean).length > 0 && (
                <DriverCopy>
                  {[
                    route.turnByTurn[0].currentRoadName &&
                      'Current road: ' + route.turnByTurn[0].currentRoadName,
                    (route.turnByTurn[0].nextRoadName ?? route.turnByTurn[0].roadName) &&
                      'Next road: ' +
                        (route.turnByTurn[0].nextRoadName ?? route.turnByTurn[0].roadName),
                    route.turnByTurn[0].exitNumber &&
                      'Exit ' + route.turnByTurn[0].exitNumber,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </DriverCopy>
              )}
              {route.turnByTurn[1] && (
                <DriverCopy>{`Then: ${route.turnByTurn[1].instruction}`}</DriverCopy>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <DriverCopy>
            {g?.instruction ?? 'Waiting for live guidance data'}
          </DriverCopy>
          {g?.action && (
            <DriverCopy>
              {g.action}
              {g.maneuverMeters !== undefined
                ? ' · ' + distanceText(g.maneuverMeters, metric)
                : ''}
            </DriverCopy>
          )}
          {progress?.legNumber!==undefined && <DriverCopy>Leg {progress.legNumber} of {progress.legCount}</DriverCopy>}
          {g?.currentRoad && (
            <DriverCopy>Current road: {g.currentRoad}</DriverCopy>
          )}
          {g?.nextRoad && <DriverCopy>Next road: {g.nextRoad}</DriverCopy>}
          {[
            g?.highway,
            g?.exit && 'Exit ' + g.exit,
            g?.toward && 'Toward ' + g.toward,
          ].filter(Boolean).length > 0 && (
            <DriverCopy>
              {[
                g?.highway,
                g?.exit && 'Exit ' + g.exit,
                g?.toward && 'Toward ' + g.toward,
              ]
                .filter(Boolean)
                .join(' · ')}
            </DriverCopy>
          )}
          {g?.subsequent && <DriverCopy>Then: {g.subsequent}</DriverCopy>}
          <DriverCopy>
            {data.remainingMeters === undefined
              ? 'Remaining distance unavailable'
              : distanceText(data.remainingMeters, metric) + ' remaining'}
            {data.remainingSeconds === undefined
              ? ' · ETA unavailable'
              : ' · ' +
                Math.ceil(data.remainingSeconds / 60) +
                ' min remaining'}
          </DriverCopy>
          {data.remainingSeconds !== undefined &&
            state.progressObservedAt !== undefined && (
              <DriverCopy>
                Estimated arrival (device time):{' '}
                {new Date(
                  state.progressObservedAt + data.remainingSeconds * 1000,
                ).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </DriverCopy>
            )}
          <LaneGuidance lanes={g?.lanes} />
          {g?.junction && (
            <View testID="junction-guidance">
              <DriverCopy>
                {g.junction.label}: {g.junction.directions.join(' · ')}
              </DriverCopy>
            </View>
          )}
          {g?.speedLimitMph !== undefined && (
            <DriverCopy>
              Provider speed limit:{' '}
              {Math.round(g.speedLimitMph * (metric ? 1.609344 : 1))}{' '}
              {metric ? 'km/h' : 'mph'}
            </DriverCopy>
          )}
        </>
      )}
      <DriverCopy>
        {data.speedMps === undefined
          ? 'GPS speed unavailable'
          : 'GPS speed: ' +
            Math.round(data.speedMps * (metric ? 3.6 : 2.236936)) +
            (metric ? ' km/h' : ' mph')}
        {!data.gpsFresh ? ' · Waiting for fresh GPS' : ''}
      </DriverCopy>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 10, gap: 4, borderRadius: 12 },
});
