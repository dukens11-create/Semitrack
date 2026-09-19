import { Alert } from '../../components/ThemedAlert';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DriverSheet } from '../../components/DriverSheet';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Services } from '../../app/services';
import type { TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../../services/location/LocationService';
import {
  DriverButton,
  DriverCopy,
  useDriverPalette,
} from '../../components/DriverUI';
import { RouteProgressMonitor } from './RouteProgressMonitor';
import { WarningManager } from './WarningManager';
export function RouteAdvisories({
  services,
  route,
  fix,
  expanded,
  onOpen,
  onClose,
}: {
  services: Services;
  route: TruckRoute;
  fix: LocationFix | null;
  expanded: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const p = useDriverPalette();
  const monitor = useMemo(
    () => new RouteProgressMonitor(route.routeGeometry),
    [route],
  );
  const warningScope = useMemo(
    () => ({ route, manager: new WarningManager() }),
    [route],
  );
  const { manager } = warningScope;
  const [, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('Road warnings not loaded.');
  const request = useRef<AbortController | null>(null);
  const projection = useMemo(() => monitor.update(fix), [monitor, fix]);
  useEffect(() => {
    setBusy(false);
    setNotice('Road warnings not loaded.');
    const timer = setInterval(() => setRevision(v => v + 1), 5000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [manager]);
  const warnings =
    projection.offset === undefined ||
    !fix ||
    Date.now() - fix.timestamp > 15000
      ? []
      : manager.visible(projection.offset);
  async function load() {
    if (busy) return;
    const current = services.location.getFreshFix();
    const start = monitor.update(current);
    if (!current || start.offset === undefined) {
      setNotice('Fresh GPS matched unambiguously to this route is required.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const [restrictions, events] = await Promise.all([
        services.poi.corridor(
          'restrictions',
          route,
          0,
          current,
          controller.signal,
        ),
        services.poi.corridor(
          'road-events',
          route,
          0,
          current,
          controller.signal,
        ),
      ]);
      if (
        controller.signal.aborted ||
        services.routes.getSnapshot().route !== route
      )
        return;
      manager.load(
        [
          ...restrictions.map(item => ({ ...item, severity: 'HIGH' })),
          ...events,
        ],
        start.offset,
      );
      setNotice(
        'Provider advisories expire locally after five minutes. Missing coverage does not mean roads are clear.',
      );
      setRevision(v => v + 1);
    } catch {
      if (!controller.signal.aborted)
        setNotice('Road warning data unavailable.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const details = (
    <>
      {(expanded || projection.status === 'off-route') && (
        <DriverCopy>
          {projection.status === 'off-route'
            ? 'GPS repeatedly away from planned route. Follow road signs; commercial rerouting requires licensed guidance.'
            : notice}
        </DriverCopy>
      )}
      {expanded && (
        <DriverButton
          title="Refresh road warnings"
          secondary
          loading={busy}
          onPress={() => {
            void load();
          }}
        />
      )}
      {warnings.map(w => (
        <React.Fragment key={w.id}>
          <DriverCopy>
            {w.severity} · {w.stage} · {w.title} ·{' '}
            {projection.offset !== undefined
              ? Math.max(0, (w.offset - projection.offset) / 1609.344).toFixed(
                  1,
                ) + ' mi ahead · '
              : ''}
            Source: {w.source}
          </DriverCopy>
          <DriverButton
            title={
              (w.severity === 'HIGH' ? 'Acknowledge ' : 'Dismiss ') + w.title
            }
            secondary
            onPress={() => {
              if (w.severity === 'HIGH') {
                Alert.alert(
                  'Acknowledge warning?',
                  'This hides this alert only. Truck restrictions and road instructions still apply.',
                  [
                    { text: 'Keep warning', style: 'cancel' },
                    {
                      text: 'Acknowledge',
                      onPress: () => {
                        manager.dismiss(w.id, true);
                        setRevision(v => v + 1);
                      },
                    },
                  ],
                );
              } else {
                manager.dismiss(w.id);
                setRevision(v => v + 1);
              }
            }}
          />
        </React.Fragment>
      ))}
    </>
  );
  // WarningManager already orders by severity and then route distance.
  const important = warnings[0];
  return (
    <>
      {!expanded && projection.status === 'off-route' && (
        <View style={[styles.notice, { backgroundColor: p.warningSurface }]}>
          <Text style={[styles.noticeText, { color: p.warningText }]}>
            GPS is away from the planned route. Follow road signs; live
            commercial rerouting requires licensed guidance.
          </Text>
        </View>
      )}
      {!expanded && important && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review route warnings"
          onPress={onOpen}
          style={[styles.notice, { backgroundColor: p.warningSurface }]}
        >
          <Text style={[styles.noticeTitle, { color: p.warningText }]}>
            {important.severity} · {warnings.length} route{' '}
            {warnings.length === 1 ? 'warning' : 'warnings'}
          </Text>
          <Text
            style={[styles.noticeText, { color: p.warningText }]}
            numberOfLines={2}
          >
            {important.title}
          </Text>
        </Pressable>
      )}
      {expanded &&
        (onClose ? (
          <DriverSheet title="Road warnings" onClose={onClose}>
            {details}
            <DriverButton
              title="Close road warnings"
              secondary
              onPress={onClose}
            />
          </DriverSheet>
        ) : (
          details
        ))}
    </>
  );
}
const styles = StyleSheet.create({
  notice: {
    padding: 10,
    gap: 3,
    backgroundColor: '#392B1B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#926C39',
  },
  noticeTitle: { color: '#FFE0A9', fontWeight: '800', fontSize: 12 },
  noticeText: { color: '#FFE5BD', fontSize: 12, lineHeight: 17 },
});
