import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import type { Services } from '../../app/services';
import type { TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../../services/location/LocationService';
import { useStore } from '../../hooks/useStore';
import { DriverSheet } from '../../components/DriverSheet';
import {
  DriverCopy,
  DriverButton,
  useDriverPalette,
} from '../../components/DriverUI';
import {
  weatherPresentation,
  temperatureUnit,
  temperatureText,
  activeWeatherAlerts,
} from './weatherPresentation';
export function WeatherStatus({
  services,
  route,
  fix,
  driving = false,
  detailsRequest = 0,
}: {
  services: Services;
  route: TruckRoute | null;
  fix: LocationFix | null;
  driving?: boolean;
  detailsRequest?: number;
}) {
  const p = useDriverPalette(),
    { settings } = useStore(services.settings);
  const [raw, setRaw] = useState<Record<string, unknown>>(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (detailsRequest > 0) setOpen(true);
  }, [detailsRequest]);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setRaw(undefined);
    setBusy(false);
    return () => {
      request.current?.abort();
    };
  }, [route]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const data = weatherPresentation(raw, fix, Math.max(now, Date.now())),
    unit = temperatureUnit(settings),
    alerts =
      data.status === 'CURRENT' ? activeWeatherAlerts(raw?.alerts, now) : [];
  async function refresh() {
    if (request.current || !route || !services.poi.routeWeather) return;
    const current = services.location.getFreshFix();
    if (!current) {
      setRaw(undefined);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const items = await services.poi.routeWeather(
        route,
        current,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        services.routes.getSnapshot().route === route
      )
        setRaw(items.find(item => item.label === 'Current route location'));
    } catch {
      if (!controller.signal.aborted) setRaw(undefined);
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(false);
        setNow(Date.now());
      }
    }
  }
  return (
    <View>
      {!driving && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Weather details"
          onPress={() => setOpen(true)}
          style={[
            styles.status,
            { backgroundColor: p.card, borderColor: p.border },
          ]}
        >
          <Text style={[styles.statusText, { color: p.text }]}>
            {data.status === 'CURRENT'
              ? temperatureText(data.tempF, unit) + ' · ' + data.condition
              : data.status === 'STALE'
              ? 'Weather · stale'
              : 'Weather · unavailable'}
          </Text>
        </Pressable>
      )}
      {alerts.map(alert => (
        <Pressable
          key={alert.title}
          accessibilityRole="button"
          accessibilityLabel={'Weather alert: ' + alert.title}
          onPress={() => setOpen(true)}
          style={[styles.alert, { backgroundColor: p.warningSurface }]}
        >
          <Text style={[styles.alertText, { color: p.warningText }]}>
            {alert.title}
          </Text>
        </Pressable>
      ))}
      {open && (
        <DriverSheet title="Weather" onClose={() => setOpen(false)}>
          <DriverCopy>
            {data.status === 'CURRENT'
              ? temperatureText(data.tempF, unit) +
                ' · ' +
                data.condition +
                ' · ' +
                data.provider +
                ' · ' +
                String(data.observedAt)
              : data.status === 'STALE'
              ? 'Weather is stale or no longer near your location. Refresh before relying on it.'
              : 'Current weather is unavailable. No temperature is assumed.'}
          </DriverCopy>
          <DriverCopy>
            Area observation, not a road-surface report or arrival-time
            forecast. Weather requires a configured backend provider and a fresh
            position on an accepted route.
          </DriverCopy>
          {alerts.length ? (
            alerts.map(alert => (
              <DriverCopy key={alert.title}>
                {alert.severity + ': ' + alert.title + ' · ' + alert.provider}
              </DriverCopy>
            ))
          ) : (
            <DriverCopy>
              Official weather alerts are not supplied by the current weather
              API. No active-alert claim is made.
            </DriverCopy>
          )}
          <DriverButton
            title={busy ? 'Loading weather…' : 'Refresh current weather'}
            loading={busy}
            disabled={!route}
            onPress={() => {
              void refresh();
            }}
          />
          <DriverCopy>Choose °F or °C in Account and settings.</DriverCopy>
        </DriverSheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: { fontWeight: '700', fontSize: 12 },
  alert: { padding: 10, backgroundColor: '#8B3028', borderRadius: 10 },
  alertText: { color: 'white', fontWeight: '800' },
});
