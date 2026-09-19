import {
  currentObservation,
  currentDieselPrice,
} from '../navigation/providerEvidence';
import { stationStatus } from '../poi/stationStatus';
import React, { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet } from 'react-native';
import { Card, Copy, Button } from '../../components/ui';

export function safePublicMedia(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const labels: Record<string, string> = {
  name: 'Name',
  title: 'Report',
  label: 'Location on route',
  description: 'Details',
  reason: 'Availability',
  provider: 'Source',
  attribution: 'Attribution',
  sourceUrl: 'Public source',
  jurisdiction: 'Jurisdiction',
  source: 'Source',
  dataStatus: 'Data status',
  status: 'Status',
  lastUpdated: 'Provider updated',
  observedAt: 'Observed',
  affectedRoad: 'Road',
  roadway: 'Road',
  direction: 'Direction',
  tempF: 'Temperature °F',
  feelsLikeF: 'Feels like °F',
  windMph: 'Wind mph',
  condition: 'Condition',
};
export function recordLines(item: Record<string, unknown>): string[] {
  const lines = Object.entries(labels).flatMap(([key, label]) => {
    const value = item[key];
    return typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
      ? [label + ': ' + String(value).replace(/_/g, ' ')]
      : [];
  });
  const ahead = item.routeDistanceAheadMeters;
  if (typeof ahead === 'number' && Number.isFinite(ahead) && ahead >= 0)
    lines.push(
      (ahead / 1609.344).toFixed(1) +
        ' mi ahead along planned route; not driving detour distance',
    );
  for (const key of ['currentAvailability', 'currentStatus']) {
    const value = item[key];
    if (value && typeof value === 'object') {
      const report = value as Record<string, unknown>;
      lines.push(
        'Reported status: ' +
          (key === 'currentStatus'
            ? stationStatus(report)
            : report.stale === false &&
              currentObservation(report, 900000) &&
              typeof report.value === 'string'
            ? report.value
            : 'UNKNOWN'),
      );
      if (typeof report.source === 'string')
        lines.push('Status source: ' + report.source);
      if (typeof report.lastReportedAt === 'string')
        lines.push('Reported: ' + report.lastReportedAt);
    }
  }
  if (Array.isArray(item.prices)) {
    for (const raw of item.prices) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      if (!currentDieselPrice(p)) continue;
      for (const key of ['cashPrice', 'creditPrice']) {
        const price = Number(p[key]);
        if (price > 0 && Number.isFinite(price))
          lines.push(
            (key === 'cashPrice' ? 'Cash' : 'Credit') +
              ' diesel: ' +
              price +
              ' ' +
              String(p.currency ?? 'currency unknown') +
              ' · source ' +
              String(p.source ?? 'unknown') +
              ' · ' +
              String(p.observedAt) +
              ' · confirm price basis at station',
          );
      }
    }
  }
  if (item.status === 'AREA_OBSERVATION')
    lines.push(
      'Area observation near the route point; not an arrival-time forecast or exact road condition.',
    );
  return lines.length
    ? lines
    : ['Provider record contains no displayable details. Conditions unknown.'];
}
export function CorridorRecords({
  items,
}: {
  items: Record<string, unknown>[];
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(v => v + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {items.map((item, index) => {
        const image =
          item.dataStatus === 'CURRENT_PROVIDER_REPORT' &&
          currentObservation(item, 900000)
            ? safePublicMedia(item.imageUrl)
            : null;
        const stream =
          item.dataStatus === 'CURRENT_PROVIDER_REPORT'
            ? safePublicMedia(item.streamUrl)
            : null;
        return (
          <Card key={String(item.id ?? index)}>
            {recordLines(item).map((line, i) => (
              <Copy key={i}>{line}</Copy>
            ))}
            {image && (
              <Image
                accessibilityLabel="Provider camera image; check its timestamp"
                source={{ uri: image }}
                style={styles.camera}
                resizeMode="contain"
              />
            )}
            {stream && (
              <Button
                title="Open provider camera"
                onPress={() => {
                  void Linking.openURL(stream).catch(() => {});
                }}
              />
            )}
          </Card>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({ camera: { width: '100%', height: 180 } });
