import { planFromTrip } from '../src/screens/DriverLibraryScreens';
import { MAX_INTERMEDIATE_STOPS } from '../src/models/routeLimits';
import {
  beginRouteDiagnostic,
  clearRouteDiagnostics,
  routeDiagnosticHistory,
} from '../src/features/routing/routeTelemetry';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Text, TextInput } from 'react-native';
import { PlanningScreen } from '../src/screens/PlanningScreen';
import { RouteStops } from '../src/features/stops/RouteStops';
import {
  appendDestination,
  createStopPlan,
  removeRouteStop,
  reorderRouteStop,
  type StopPlan,
} from '../src/features/stops/StopPlan';
import { RouteStore } from '../src/features/routing/RouteStore';
import { TruckRoutingService } from '../src/services/routing/TruckRoutingService';
import { SettingsService } from '../src/features/settings/SettingsService';
import { UnavailableNavigationEngine } from '../src/services/guidance/NavigationEngine';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { DriverCard } from '../src/components/DriverUI';
import { Alert } from '../src/components/ThemedAlert';
import { Store } from '../src/state/Store';
import { serializeTruck, type Coordinate } from '../src/models/contracts';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { Services } from '../src/app/services';
import { truck, routeRaw, user, deferred } from './fixtures';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn(),
    StyleURL: { Dark: 'dark', Street: 'street' },
  },
}));
const a = { id: 'a', name: 'Provider destination A', lat: 40, lng: -100.01 };
const b = { id: 'b', name: 'Provider destination B', lat: 40, lng: -100.02 };
const c = { id: 'c', name: 'Provider destination C', lat: 40, lng: -100.03 };
const origin = { lat: 40, lng: -100 };
const ordered = (plan: StopPlan) => [...plan.stops, plan.destination];
function fullPlan(): StopPlan {
  return {
    destination: { ...a, lng: -100.04 },
    stops: Array.from({ length: MAX_INTERMEDIATE_STOPS }, (_, i) => ({
      id: `capacity-${i}`,
      name: `Test stop ${i + 1}`,
      lat: 40,
      lng: -100 - (i + 1) * 0.001,
    })),
  };
}
test('25 intermediate stops render all numbered controls and disable Add Stop without corrupting the plan', async () => {
  const { services, routes, request } = await setup(fullPlan());
  const before = routes.getSnapshot();
  await mount(services);
  expect(control('+ Add Stop')!.props.disabled).toBe(true);
  await press('Stops');
  expect(text()).toContain('Final destination');
  expect(text()).toContain('Maximum 25 intermediate stops');
  expect(control('View stop 26')).toBeDefined();
  expect(control('Move stop 25 earlier')).toBeDefined();
  expect(() => appendDestination(before.plan!, b)).toThrow('count');
  expect(routes.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});
test('remove/reorder at capacity recalculates ordered stops with the same truck and re-enables Add Stop', async () => {
  const { services, routes, request } = await setup(fullPlan());
  await mount(services);
  await press('Stops');
  await press('Move stop 25 earlier');
  expect(routes.getSnapshot().plan!.stops[23]!.id).toBe('capacity-24');
  await press('Stops');
  await press('Remove stop 1');
  expect(routes.getSnapshot().plan!.stops).toHaveLength(24);
  expect(control('+ Add Stop')!.props.disabled).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.at(-1)![2]).toMatchObject({
    truck: serializeTruck(truck, true),
  });
});
test('27-location diagnostic count survives sanitization', () => {
  clearRouteDiagnostics();
  beginRouteDiagnostic(truck, 27);
  expect(routeDiagnosticHistory().at(-1)).toMatchObject({ stopCount: 27 });
  clearRouteDiagnostics();
});
let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.restoreAllMocks();
});
function control(label: string) {
  return screen!.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0];
}
async function press(label: string) {
  const button = control(label)!;
  expect(button).toBeDefined();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => {
    button.props.onPress();
  });
}
const text = () =>
  screen!.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
function response(points: Coordinate[]) {
  const maneuvers = points.slice(1).map((_, index) => ({
    ...routeRaw.turnByTurn[0]!,
    step: index + 1,
    offset: index + 1,
  }));
  return {
    ...routeRaw,
    validatedStops: points,
    routeGeometry: points.map(p => [p.lng, p.lat]),
    turnByTurn: maneuvers,
    legs: maneuvers.map(m => ({
      distanceMiles: 1,
      durationSeconds: 60,
      geometry: [],
      maneuvers: [m],
    })),
  };
}
async function setup(plan = createStopPlan(a)) {
  const request = jest.fn(
    async (
      _method: string,
      _path: string,
      body: {
        origin: Coordinate;
        viaStops: Coordinate[];
        destination: Coordinate;
      },
    ) => response([body.origin, ...body.viaStops, body.destination]),
  );
  const routes = new RouteStore(
    new TruckRoutingService({ request } as unknown as ApiClient),
  );
  expect(await routes.calculate(origin, plan, truck)).toBe(true);
  request.mockClear();
  const fix = {
    latitude: origin.lat,
    longitude: origin.lng,
    timestamp: Date.now(),
    accuracy: 5,
    speed: 0,
    heading: null,
  };
  const services = {
    routes,
    environment: { mapboxToken: '' },
    auth: new Store({ status: 'signedIn', user }),
    trucks: Object.assign(new Store({ profiles: [truck], selected: truck }), {
      load: jest.fn(async () => {}),
    }),
    location: Object.assign(new Store({ fix, tracking: true }), {
      startIfPermitted: jest.fn(async () => {}),
      getFreshFix: jest.fn(() => fix),
      requestFreshFix: jest.fn(async () => fix),
    }),
    settings: new SettingsService({
      request: jest.fn(async () => ({
        voiceEnabled: true,
        voiceMuted: false,
        voiceLocale: 'en-US',
        units: 'imperial',
        dayNightMode: 'day',
        trafficReroute: false,
        settingsJson: null,
      })),
    } as unknown as ApiClient),
    search: { search: jest.fn(async () => [b]) },
    poi: {
      nearby: jest.fn(async () => []),
      alongRoute: jest.fn(async () => []),
      routeWeather: jest.fn(async () => []),
    },
    guidance: Object.assign(new UnavailableNavigationEngine(), {
      startNavigation: jest.fn(),
    }),
  } as unknown as Services;
  return { services, request, routes };
}
async function mount(services: Services, mode: 'day' | 'night' = 'day') {
  AppState.currentState = 'active';
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <PlanningScreen services={services} />
      </DriverAppearanceContext.Provider>,
    );
  });
}
async function selectNext() {
  await press('+ Add Stop');
  await act(async () =>
    screen!.root
      .findByType(TextInput)
      .props.onChangeText('next provider place'),
  );
  await press('Search');
  const card = screen!.root
    .findAllByType(DriverCard)
    .find(n => n.findAllByType(Text).some(t => t.props.children === b.name));
  expect(card).toBeDefined();
  await act(async () => card!.props.onPress());
}

test.each(['day', 'night'] as const)(
  'preview exposes Add Stop and Stops in %s before provisioning',
  async mode => {
    const { services } = await setup();
    await mount(services, mode);
    expect(control('+ Add Stop')!.props.disabled).toBe(false);
    expect(control('Stops')).toBeDefined();
    expect(control('Cancel Route')).toBeDefined();
    await press('Start Navigation');
    expect(text()).toContain('CoPilot provisioning required');
    expect(services.guidance.startNavigation).not.toHaveBeenCalled();
  },
);
test('Add Stop appends B after A and preserves the entire verified truck payload', async () => {
  const { services, routes, request } = await setup();
  await mount(services);
  await selectNext();
  expect(control('Set final destination')).toBeUndefined();
  await press('Add Stop & recalculate');
  expect(ordered(routes.getSnapshot().plan!)).toEqual([a, b]);
  expect(request).toHaveBeenCalledTimes(1);
  const [method, path, body] = request.mock.calls[0]!;
  expect([method, path]).toEqual(['POST', '/routing/truck-route']);
  expect(body).toEqual(
    expect.objectContaining({
      origin,
      viaStops: [{ lat: a.lat, lng: a.lng }],
      destination: { lat: b.lat, lng: b.lng },
      truck: serializeTruck(truck, true),
      truckProfileId: truck.id,
      truckRevision: truck.revision,
    }),
  );
  expect(services.trucks.getSnapshot().selected).toBe(truck);
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
});
test('closing Add Stop leaves the original route and ordered plan untouched', async () => {
  const { services, routes, request } = await setup();
  const before = routes.getSnapshot();
  await mount(services);
  await press('+ Add Stop');
  await press('Close Add Stop');
  expect(routes.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});
test('Stop View shows the provider name and never calculates or changes truck access', async () => {
  const { services, routes, request } = await setup();
  const before = routes.getSnapshot();
  await mount(services);
  await press('Stops');
  await press('View stop 1');
  expect(text()).toContain(a.name);
  expect(text()).toContain('does not verify a truck entrance');
  await press('Back to stops');
  expect(control('Close Route Stops')).toBeDefined();
  expect(routes.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});
test('removing the final destination promotes the last remaining stop without clearing the route', async () => {
  const { services, routes, request } = await setup(
    appendDestination(createStopPlan(a), b),
  );
  await mount(services);
  await press('Stops');
  await press('Remove stop 2');
  expect(routes.getSnapshot().plan).toEqual(createStopPlan(a));
  expect(routes.getSnapshot().route).not.toBeNull();
  expect(request.mock.calls[0]![2]).toMatchObject({
    viaStops: [],
    destination: { lat: a.lat, lng: a.lng },
  });
});
test('removing an intermediate stop sends every remaining stop in order with the same truck', async () => {
  const { services, routes, request } = await setup(
    appendDestination(appendDestination(createStopPlan(a), b), c),
  );
  await mount(services);
  await press('Stops');
  await press('Remove stop 2');
  expect(ordered(routes.getSnapshot().plan!)).toEqual([a, c]);
  expect(request.mock.calls[0]![2]).toMatchObject({
    viaStops: [{ lat: a.lat, lng: a.lng }],
    destination: { lat: c.lat, lng: c.lng },
    truck: serializeTruck(truck, true),
  });
});
test('reordering the final destination recalculates the actual reordered full plan', async () => {
  const { services, routes, request } = await setup(
    appendDestination(createStopPlan(a), b),
  );
  await mount(services);
  await press('Stops');
  await press('Move stop 2 earlier');
  expect(ordered(routes.getSnapshot().plan!)).toEqual([b, a]);
  expect(request.mock.calls[0]![2]).toMatchObject({
    viaStops: [{ lat: b.lat, lng: b.lng }],
    destination: { lat: a.lat, lng: a.lng },
  });
});
test('last remaining destination cannot be removed by a stop action', async () => {
  const { services, request } = await setup();
  await mount(services);
  await press('Stops');
  expect(control('Remove stop 1')!.props.disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
  expect(() => removeRouteStop(createStopPlan(a), a.id)).toThrow(
    'Cancel Route',
  );
});
test('provider rejection retains the original preview and has no alternate routing request', async () => {
  const { services, routes, request } = await setup();
  const before = routes.getSnapshot();
  request.mockRejectedValueOnce(
    Object.assign(new Error('restriction'), {
      code: 'TRIMBLE_RESTRICTION_WARNING',
    }),
  );
  await mount(services);
  await selectNext();
  await press('Add Stop & recalculate');
  expect(request).toHaveBeenCalledTimes(1);
  expect(routes.getSnapshot().plan).toBe(before.plan);
  expect(routes.getSnapshot().route).toBe(before.route);
  expect(routes.getSnapshot().errorCode).toBe('TRIMBLE_RESTRICTION_WARNING');
  expect(control('Add Stop & recalculate')).toBeDefined();
});
test('Cancel Route during pending Add Stop ignores the late provider response', async () => {
  const { services, routes, request } = await setup();
  const wait = deferred<ReturnType<typeof response>>();
  request.mockReturnValueOnce(wait.promise);
  await mount(services);
  await selectNext();
  await press('Add Stop & recalculate');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('Cancel Route');
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel route')!
      .onPress!(),
  );
  await act(async () => wait.resolve(response([origin, a, b])));
  expect(routes.getSnapshot()).toEqual({
    phase: 'idle',
    plan: null,
    route: null,
  });
  expect(services.trucks.getSnapshot().selected).toBe(truck);
});
test('duplicate submission while route calculation is pending sends only one request', async () => {
  const { services, request } = await setup();
  const wait = deferred<ReturnType<typeof response>>();
  request.mockReturnValueOnce(wait.promise);
  await mount(services);
  await selectNext();
  const submit = control('Add Stop & recalculate')!.props.onPress;
  await act(async () => {
    submit();
    submit();
    submit();
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => wait.resolve(response([origin, a, b])));
});
test('profile change during GPS acquisition prevents recalculation with a stale truck', async () => {
  const { services, request } = await setup();
  const wait = deferred<unknown>();
  jest
    .mocked(services.location.requestFreshFix)
    .mockImplementationOnce(
      () =>
        wait.promise as ReturnType<typeof services.location.requestFreshFix>,
    );
  await mount(services);
  await selectNext();
  await press('Add Stop & recalculate');
  jest
    .spyOn(services.trucks, 'getSnapshot')
    .mockReturnValue({ profiles: [], selected: null });
  await act(async () => wait.resolve(undefined));
  expect(request).not.toHaveBeenCalled();
});
test('append/reorder helpers preserve original plan, reject duplicates and enforce existing stop cap', () => {
  const original = createStopPlan(a);
  const next = appendDestination(original, b);
  expect(original).toEqual(createStopPlan(a));
  expect(ordered(next)).toEqual([a, b]);
  expect(() => appendDestination(next, a)).toThrow('Duplicate');
  expect(() => reorderRouteStop(next, 0, 2)).toThrow('Invalid');
  expect(() => removeRouteStop(next, 'missing')).toThrow('missing');
  const full = {
    destination: a,
    stops: Array.from({ length: MAX_INTERMEDIATE_STOPS }, (_, i) => ({
      ...b,
      id: 'fixture-' + i,
    })),
  };
  expect(() => appendDestination(full, c)).toThrow('count');
});
test('route editing controls are disabled during genuine guidance', async () => {
  const onRemove = jest.fn(),
    onReorder = jest.fn();
  await act(async () => {
    screen = create(
      <RouteStops
        plan={appendDestination(createStopPlan(a), b)}
        disabled
        onView={jest.fn()}
        onRemove={onRemove}
        onReorder={onReorder}
      />,
    );
  });
  expect(control('Remove stop 1')!.props.disabled).toBe(true);
  expect(control('Move stop 2 earlier')!.props.disabled).toBe(true);
  expect(onRemove).not.toHaveBeenCalled();
  expect(onReorder).not.toHaveBeenCalled();
});

test('a route change closes the stale Add Stop selection instead of turning it into replace destination', async () => {
  const { services, routes, request } = await setup();
  await mount(services);
  await selectNext();
  await act(async () => routes.clear());
  expect(control('Add Stop & recalculate')).toBeUndefined();
  expect(control('Set final destination')).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});

test('leaving Map cancels Add Stop mode while keeping the route', async () => {
  const { services, routes, request } = await setup();
  const before = routes.getSnapshot();
  await mount(services);
  await press('+ Add Stop');
  await act(async () =>
    screen!.update(<PlanningScreen services={services} active={false} />),
  );
  await act(async () =>
    screen!.update(<PlanningScreen services={services} active />),
  );
  expect(control('Close Add Stop')).toBeUndefined();
  expect(routes.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});

test('Add Stop search failure is retryable and never changes the existing plan', async () => {
  const { services, routes, request } = await setup();
  const before = routes.getSnapshot();
  jest
    .mocked(services.search.search)
    .mockRejectedValueOnce(new Error('fixture network unavailable'));
  await mount(services);
  await press('+ Add Stop');
  await act(async () =>
    screen!.root
      .findByType(TextInput)
      .props.onChangeText('next provider place'),
  );
  await press('Search');
  expect(text()).toContain('Places could not be loaded');
  expect(routes.getSnapshot()).toBe(before);
  await press('Search');
  expect(services.search.search).toHaveBeenCalledTimes(2);
  expect(text()).toContain(b.name);
  expect(request).not.toHaveBeenCalled();
});

test('saved 25-stop plan restores order, refuses overflow, and dispatch pickup consumes one slot', () => {
  const plan = fullPlan(),
    saved = {
      id: 'saved',
      name: 'Synthetic plan',
      status: 'PLANNED',
      revision: 1,
      origin: { ...origin, id: 'origin', name: 'Origin' },
      ...plan,
      assigned: false,
      startedAt: null,
      completedAt: null,
    };
  expect(planFromTrip(saved)).toEqual(plan);
  expect(() => planFromTrip({ ...saved, stops: [...plan.stops, b] })).toThrow();
  expect(() => planFromTrip({ ...saved, assigned: true })).toThrow('count');
  expect(
    planFromTrip({ ...saved, assigned: true, stops: plan.stops.slice(1) })
      .stops,
  ).toHaveLength(MAX_INTERMEDIATE_STOPS);
});
test('Cancel Route at capacity permits a new plan and preserves the active truck', async () => {
  const { services, routes, request } = await setup(fullPlan());
  await mount(services);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('Cancel Route');
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(item => item.text === 'Cancel route')!
      .onPress!(),
  );
  expect(routes.getSnapshot().plan).toBeNull();
  expect(services.trucks.getSnapshot().selected).toBe(truck);
  expect(request).not.toHaveBeenCalled();
  await act(async () => {
    await routes.calculate(origin, createStopPlan(a), truck);
  });
  expect(routes.getSnapshot().plan).toEqual(createStopPlan(a));
});
