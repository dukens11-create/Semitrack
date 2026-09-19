import { routeDisplayProgress } from '../src/features/navigation/routeDisplayProgress';
import { stationStatus } from '../src/features/poi/stationStatus';
import { applyGuidanceEvent } from '../src/features/navigation/guidanceEvents';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { route } from './fixtures';
import { NavigationHud } from '../src/features/navigation/NavigationHud';
import { navigationPresentation } from '../src/features/navigation/navigationPresentation';
import {
  cameraPolicy,
  normalizeHeading,
} from '../src/features/map/cameraPolicy';
import { RouteProgressMonitor } from '../src/features/navigation/RouteProgressMonitor';
import { WarningManager } from '../src/features/navigation/WarningManager';
import { aheadPois } from '../src/features/poi/PoiService';
import { poiDetails } from '../src/features/poi/PoiPresentation';
import {
  offlineBounds,
  OFFLINE_DISPLAY_NOTICE,
} from '../src/features/offline/offlinePolicy';
import { EldService, authorizedEldUrl } from '../src/features/eld/EldService';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { NavigationState } from '../src/services/guidance/NavigationEngine';
import { mapPreferences } from '../src/features/settings/mapPreferences';
const now = 1700000000000;
const fix = {
  latitude: 40,
  longitude: -100,
  accuracy: 5,
  timestamp: now,
  heading: 90,
  speed: 25,
};
const state: NavigationState = {
  phase: 'navigating',
  routeId: 'test-route',
  remainingMeters: 1000,
  remainingSeconds: 120,
  guidance: {
    source: 'copilot',
    observedAt: now,
    instruction: 'Continue',
    action: 'straight',
    currentRoad: 'Current road',
    nextRoad: 'Next road',
    maneuverMeters: 100,
  },
};
let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
const text = () =>
  screen.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
test('HUD hidden without accepted route', async () => {
  await act(async () => {
    screen = create(<NavigationHud route={null} state={state} fix={fix} />);
  });
  expect(screen.toJSON()).toBeNull();
});
test('preview contains estimates but cannot show live remaining progress, speed limit or lane guidance', async () => {
  await act(async () => {
    screen = create(
      <NavigationHud
        route={route()}
        state={{ ...state, phase: 'unavailable' }}
        fix={null}
      />,
    );
  });
  expect(text()).toContain('Trimble estimate');
  expect(text()).not.toContain('Provider speed limit');
  expect(
    screen.root
      .findAllByType(View)
      .filter(n => n.props.testID === 'lane-guidance'),
  ).toHaveLength(0);
});
test('HUD uses current route-bound provider instruction, GPS speed, lanes and junction only when supplied', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const live = {
    ...state,
    guidance: {
      ...state.guidance!,
      speedLimitMph: 55,
      lanes: [{ directions: ['straight'], recommended: true }],
      junction: { label: 'Exit 1', directions: ['right'] },
    },
  };
  await act(async () => {
    screen = create(<NavigationHud route={route()} state={live} fix={fix} />);
  });
  expect(text()).toContain('Continue');
  expect(text()).toContain('GPS speed: 56 mph');
  expect(text()).toContain('Provider speed limit');
  expect(
    screen.root
      .findAllByType(View)
      .filter(n => n.props.testID === 'lane-guidance'),
  ).toHaveLength(1);
  expect(
    screen.root
      .findAllByType(View)
      .filter(n => n.props.testID === 'junction-guidance'),
  ).toHaveLength(1);
});
test.each(['idle', 'unavailable', 'paused', 'rerouting'] as const)(
  '%s never exposes active maneuver details',
  phase => {
    expect(
      navigationPresentation(route(), { ...state, phase }, fix, now)?.guidance,
    ).toBeUndefined();
  },
);
test('stale, malformed and wrong-route guidance never appear', () => {
  for (const change of [
    { routeId: 'other' },
    { guidance: { ...state.guidance!, observedAt: now - 15001 } },
    { guidance: { ...state.guidance!, maneuverMeters: NaN } },
  ])
    expect(
      navigationPresentation(route(), { ...state, ...change }, fix, now)
        ?.guidance,
    ).toBeUndefined();
  expect(
    navigationPresentation(
      route(),
      state,
      { ...fix, timestamp: now - 15001 },
      now,
    )?.speedMps,
  ).toBeUndefined();
});
test('absent provider fields remain absent and no preview estimates replace live remaining evidence', () => {
  const data = navigationPresentation(
    route(),
    { phase: 'navigating', routeId: 'test-route' },
    fix,
    now,
  );
  expect(data?.remainingMeters).toBeUndefined();
  expect(data?.guidance).toBeUndefined();
});
test('camera uses actual active GPS speed and provider maneuver distance; preview stays north up', () => {
  expect(cameraPolicy(fix, false, 100, now)).toMatchObject({
    zoomLevel: 15,
    heading: 0,
    pitch: 0,
  });
  expect(cameraPolicy(fix, true, undefined, now)).toMatchObject({
    zoomLevel: 14,
    heading: 90,
    pitch: 45,
  });
  expect(cameraPolicy(fix, true, 100, now)).toMatchObject({ zoomLevel: 17 });
  expect(cameraPolicy(fix, true, 100, now, false)?.zoomLevel).toBe(15);
  expect(
    cameraPolicy({ ...fix, timestamp: now - 15001 }, true, 100, now),
  ).toBeNull();
  expect(normalizeHeading(360)).toBe(0);
});
test('indexed projection is advisory only; off-route requires three distinct fixes spanning ten seconds', () => {
  const monitor = new RouteProgressMonitor([
    [-100, 40],
    [-99.99, 40],
    [-99.98, 40],
  ]);
  expect(monitor.update(fix, now)).toMatchObject({
    status: 'on-route',
    offset: 0,
  });
  const away = { ...fix, latitude: 40.01 };
  expect(monitor.update(away, now).status).toBe('unknown');
  expect(monitor.update(away, now).status).toBe('unknown');
  expect(
    monitor.update({ ...away, timestamp: now + 5000 }, now + 5000).status,
  ).toBe('unknown');
  expect(
    monitor.update({ ...away, timestamp: now + 10000 }, now + 10000).status,
  ).toBe('off-route');
  expect(
    monitor.update({ ...fix, timestamp: now + 15000 }, now + 15000).status,
  ).toBe('on-route');
});
test('route crossing is unknown rather than fabricated progress', () => {
  const monitor = new RouteProgressMonitor([
    [-100, 40],
    [-99.99, 40],
    [-100, 40],
    [-99.98, 40],
  ]);
  expect(monitor.update(fix, now).status).toBe('unknown');
});
test('warning stages, deduplication, expiry and session reset; high severity cannot be dismissed', () => {
  const manager = new WarningManager();
  const item = {
    id: 'a',
    title: 'Closure',
    source: 'DOT fixture',
    observedAt: new Date(now).toISOString(),
    severity: 'CRITICAL',
    routeDistanceAheadMeters: 2000,
  };
  manager.load([item, item, { ...item, id: 'b', severity: 'MINOR' }], 0, now);
  expect(manager.visible(0, now)).toHaveLength(2);
  expect(manager.visible(500, now)[0]?.stage).toBe('approaching');
  expect(manager.visible(1800, now)[0]?.stage).toBe('near');
  manager.dismiss('a');
  manager.dismiss('b');
  expect(manager.visible(0, now).map(w => w.id)).toEqual(['a']);
  expect(manager.visible(0, now + 300001)).toEqual([]);
  manager.reset();
  expect(manager.visible(0, now)).toEqual([]);
});
test('warnings need source and explicit route-ahead evidence', () => {
  const manager = new WarningManager();
  manager.load(
    [
      { id: 'x', title: 'Generic warning' },
      {
        id: 'y',
        title: 'Behind',
        source: 'DOT',
        routeDistanceAheadMeters: -10,
      },
    ],
    0,
    now,
  );
  expect(manager.visible(0, now)).toEqual([]);
});
test('route POIs sort ahead, deduplicate and exclude unknown route relation; weigh status stays unknown', () => {
  const poi = {
    id: 'a',
    name: 'Scale',
    category: 'weigh_station',
    latitude: 40,
    longitude: -100,
    routeDistanceAheadMeters: 100,
  };
  expect(
    aheadPois([
      poi,
      { ...poi, id: 'b', name: 'Other', routeDistanceAheadMeters: 50 },
      poi,
      { ...poi, id: 'c', routeDistanceAheadMeters: undefined },
    ]).map(p => p.id),
  ).toEqual(['b', 'a']);
  expect(poiDetails(poi)).toContain('UNKNOWN');
});
test('offline display copy never promises offline truck guidance; downloads need a fresh bounded GPS area', () => {
  expect(OFFLINE_DISPLAY_NOTICE).toContain(
    'do not provide offline truck routing',
  );
  expect(offlineBounds(fix, now)[0]![0]).toBeGreaterThan(-100);
  expect(() => offlineBounds(null, now)).toThrow();
  expect(() => offlineBounds({ ...fix, latitude: 89 }, now)).toThrow();
});
test('map settings default safely and preserve explicit choices', () => {
  expect(mapPreferences(null)).toEqual({ satellite: false, autoZoom: true });
  expect(
    mapPreferences({
      settingsJson: { rnMap: { satellite: true, autoZoom: false } },
    } as never),
  ).toEqual({ satellite: true, autoZoom: false });
});
test('ELD authorization rejects untrusted origins, credentials and wrong provider paths', () => {
  const valid =
    'https://api.samsara.com/oauth2/authorize?response_type=code&client_id=fixture&state=fixture';
  expect(authorizedEldUrl('SAMSARA', valid)).toBe(valid);
  for (const raw of [
    valid.replace('api.samsara.com', 'example.test'),
    valid.replace('https:', 'http:'),
    valid.replace('api.samsara.com', 'user:pass@api.samsara.com'),
  ])
    expect(() => authorizedEldUrl('SAMSARA', raw)).toThrow();
  expect(() => authorizedEldUrl('MOTIVE', valid)).toThrow();
});
test('ELD current driver HOS remains unknown, even if account clocks are supplied', async () => {
  const request = jest.fn(async () => ({
    status: 'UNKNOWN',
    reason: 'DRIVER_MAPPING_REQUIRED',
    certifiedEld: false,
    items: [{ remainingDriveSeconds: 99999 }],
  }));
  const service = new EldService({ request } as unknown as ApiClient);
  expect(await service.hos()).toEqual({
    status: 'UNKNOWN',
    reason: 'DRIVER_MAPPING_REQUIRED',
  });
  expect(request).toHaveBeenCalledWith(
    'GET',
    '/eld/hos/current',
    undefined,
    undefined,
  );
});

test('real provider progress and mapped maneuver events enrich HUD but cannot activate unavailable engine', () => {
  const unavailable: NavigationState = { phase: 'unavailable' };
  expect(
    applyGuidanceEvent(
      unavailable,
      unavailable,
      { type: 'onNavigationStarted', routeId: 'test-route' },
      route(),
      now,
    ).phase,
  ).toBe('unavailable');
  const active: NavigationState = {
    phase: 'navigating',
    routeId: 'test-route',
  };
  const progress = applyGuidanceEvent(
    active,
    active,
    {
      type: 'onRouteProgress',
      routeId: 'test-route',
      remainingMeters: 100,
      remainingSeconds: 20,
    },
    route(),
    now,
  );
  expect(
    navigationPresentation(route(), progress, fix, now)?.remainingMeters,
  ).toBe(100);
  expect(
    navigationPresentation(route(), progress, fix, now + 15001)
      ?.remainingMeters,
  ).toBeUndefined();
  const event = applyGuidanceEvent(
    active,
    active,
    {
      type: 'onManeuverChanged',
      routeId: 'test-route',
      offset: 3,
      distanceMeters: 50,
    },
    route(),
    now,
  );
  expect(event.guidance?.instruction).toBe('Turn');
  expect(event.guidance?.maneuverMeters).toBe(50);
  expect(
    applyGuidanceEvent(
      active,
      active,
      {
        type: 'onManeuverChanged',
        routeId: 'wrong',
        offset: 3,
        distanceMeters: 50,
      },
      route(),
      now,
    ).guidance,
  ).toBeUndefined();
});
test('speed-limit and instruction events cannot refresh unrelated stale evidence', () => {
  const active: NavigationState = { ...state };
  const updated = applyGuidanceEvent(
    active,
    active,
    { type: 'onSpeedLimitChanged', mph: 55 },
    route(),
    now + 10000,
  );
  expect(updated.guidance?.speedLimitMph).toBe(55);
  expect(updated.guidance?.maneuverMeters).toBeUndefined();
  const instruction = applyGuidanceEvent(
    updated,
    { phase: 'navigating', routeId: 'test-route' },
    { type: 'onInstruction', text: 'Provider instruction' },
    route(),
    now + 11000,
  );
  expect(instruction.guidance?.speedLimitMph).toBeUndefined();
  expect(instruction.guidance?.instruction).toBe('Provider instruction');
});

test('weigh status needs fresh sourced evidence and remains distinct from truck access', () => {
  const status = {
    value: 'OPEN',
    source: 'COMMUNITY',
    stale: false,
    lastReportedAt: new Date(now).toISOString(),
  };
  expect(stationStatus(status, now)).toBe('OPEN');
  expect(stationStatus(status, now + 900001)).toBe('UNKNOWN');
  expect(stationStatus({ ...status, source: 'UNKNOWN' }, now)).toBe('UNKNOWN');
  expect(stationStatus({ ...status, lastReportedAt: null }, now)).toBe(
    'UNKNOWN',
  );
  expect(stationStatus(null, now)).toBe('UNKNOWN');
});

test('traveled geometry is split only at a real mapped provider maneuver; no guessed projection activates it', () => {
  const accepted = route();
  expect(routeDisplayProgress(accepted, undefined)).toBeNull();
  expect(routeDisplayProgress(accepted, 1)).toBeNull();
  expect(routeDisplayProgress(accepted, 3)?.traveled).toEqual(
    accepted.routeGeometry,
  );
  expect(routeDisplayProgress(accepted, 0)?.remaining).toEqual(
    accepted.routeGeometry,
  );
});

test('invalid new maneuver or speed-limit evidence clears that display and never renews progress age', () => {
  const previous: NavigationState = {
    ...state,
    progressObservedAt: now,
    remainingMeters: 100,
    remainingSeconds: 20,
    guidance: { ...state.guidance!, speedLimitMph: 55 },
  };
  const active: NavigationState = {
    phase: 'navigating',
    routeId: 'test-route',
  };
  const invalid = applyGuidanceEvent(
    previous,
    active,
    {
      type: 'onManeuverChanged',
      routeId: 'test-route',
      offset: 3,
      distanceMeters: NaN,
    },
    route(),
    now + 1000,
  );
  expect(invalid.guidance).toBeUndefined();
  expect(invalid.progressObservedAt).toBe(now);
  expect(
    applyGuidanceEvent(
      previous,
      active,
      { type: 'onSpeedLimitChanged', mph: NaN },
      route(),
      now + 1000,
    ).guidance?.speedLimitMph,
  ).toBeUndefined();
  expect(
    navigationPresentation(route(), invalid, fix, now + 16000)?.remainingMeters,
  ).toBeUndefined();
});
