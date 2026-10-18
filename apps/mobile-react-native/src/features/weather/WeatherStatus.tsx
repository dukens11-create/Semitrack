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
    [failed, setFailed] = useState(false),
    [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (detailsRequest > 0) setOpen(true);
  }, [detailsRequest]);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setRaw(undefined);
    setBusy(false);
    lastAttempt.current = 0;
    return () => {
      request.current?.abort();
    };
  }, [route]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (fix && Date.now() - lastAttempt.current >= 300000)
      void refreshRef.current();
  }, [fix, route, now]);
  const data = weatherPresentation(raw, fix, Math.max(now, Date.now())),
    unit = temperatureUnit(settings),
    alerts =
      data.status === 'CURRENT' ? activeWeatherAlerts(raw?.alerts, now) : [];
  async function refresh() {
    if (request.current || (!services.poi.currentWeather && (!route || !services.poi.routeWeather))) return;
    const current = services.location.getFreshFix();
    if (!current) {
      setRaw(undefined);
      return;
    }
    lastAttempt.current = Date.now();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const observation = services.poi.currentWeather
        ? await services.poi.currentWeather(current, controller.signal)
        : (await services.poi.routeWeather(route!, current, controller.signal))
            .find(item => item.label === 'Current route location');
      if (
        !controller.signal.aborted && request.current === controller
      )
        setRaw(observation);
    } catch {
      if (!controller.signal.aborted) {setRaw(undefined);setFailed(true);}
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(false);
        setNow(Date.now());
      }
    }
  }
  refreshRef.current = refresh;
  return (
    <View>
      {(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={driving ? 'Current driving weather details' : 'Weather details'}
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
              : busy ? 'Weather · loading…' : failed ? 'Weather · connection error' : 'Weather · unavailable'}
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
              : raw?.reasonCode === 'WEATHER_PROVIDER_NOT_CONFIGURED'
              ? 'Weather service is not configured on the server. SemiTraX support must connect the weather provider.'
              : failed ? 'Weather could not be reached. Check your connection and retry; offline weather is unavailable.'
              : !fix ? 'Enable location to load current weather.'
              : 'Current weather is unavailable. Try refreshing.'}
          </DriverCopy>
          <DriverCopy>
            Area observation, not a road-surface report or arrival-time
            forecast. Weather requires a configured backend provider and a fresh
            position. Current weather does not require a route.
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
            disabled={!fix}
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
