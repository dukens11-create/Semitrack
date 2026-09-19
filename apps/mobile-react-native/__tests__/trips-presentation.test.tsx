import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, ScrollView, StyleSheet, Text } from 'react-native';
import { TripsScreen } from '../src/screens/DriverLibraryScreens';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { DriverButton } from '../src/components/DriverUI';
import { Store } from '../src/state/Store';
import { UnavailableNavigationEngine } from '../src/services/guidance/NavigationEngine';
import type { Services } from '../src/app/services';
import { deferred, route, truck, user } from './fixtures';
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: {
    createOperationId: jest.fn(
      async () => '00000000-0000-4000-8000-000000000123',
    ),
  },
}));

const trip = {
  id: 'trip-test',
  name: 'My saved plan',
  status: 'PLANNED',
  revision: 3,
  origin: { id: 'origin', name: 'Public origin', lat: 40, lng: -100 },
  destination: {
    id: 'destination',
    name: 'Public destination',
    lat: 40,
    lng: -100.02,
  },
  stops: [{ id: 'stop', name: 'Intermediate stop', lat: 40, lng: -100.01 }],
  assigned: false,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-12T12:00:00Z',
  truckSnapshot: truck,
};
let screen: ReactTestRenderer;
const text = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const buttons = (label: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  );
async function press(label: string) {
  await act(async () => buttons(label)[0]!.props.onPress());
}
async function setup({
  request = jest.fn(async () => ({ items: [] })),
  mode = 'day',
  currentRoute = false,
}: {
  request?: jest.Mock;
  mode?: 'day' | 'night';
  currentRoute?: boolean;
} = {}) {
  const services = {
    api: { request },
    auth: new Store({ status: 'signedIn', user }),
    routes: Object.assign(
      new Store({
        route: currentRoute ? route() : null,
        plan: currentRoute
          ? { destination: trip.destination, stops: trip.stops }
          : null,
      }),
      { clear: jest.fn(), calculate: jest.fn(async () => true) },
    ),
    trucks: new Store({ selected: truck }),
    location: {
      getFreshFix: jest.fn(() => ({ latitude: 40, longitude: -100 })),
    },
    guidance: new UnavailableNavigationEngine(),
  } as unknown as Services;
  const onMap = jest.fn();
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <TripsScreen services={services} onMap={onMap} />
      </DriverAppearanceContext.Provider>,
    );
  });
  return { services, request, onMap };
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});

test('initial load does not flash an empty state', async () => {
  const pending = deferred<unknown>();
  await setup({ request: jest.fn(() => pending.promise) });
  expect(text()).toContain('Loading trips');
  expect(text()).not.toContain('No trips yet');
  await act(async () => pending.resolve({ items: [trip] }));
  expect(text()).toContain('Public origin → Public destination');
  expect(text()).not.toContain('Loading trips');
});

test('empty Recent has one primary action and only truthful categories', async () => {
  const { onMap } = await setup();
  expect(text()).toContain('No trips yet');
  expect(buttons('Saved').length).toBeGreaterThan(0);
  expect(buttons('Save current route')).toHaveLength(0);
  expect(buttons('Refresh trips')).toHaveLength(0);
  expect(screen.root.findAllByType(DriverButton)).toHaveLength(1);
  await press('Plan a truck route');
  expect(onMap).toHaveBeenCalledTimes(1);
});

test('Planned shows plans and assignments, not completed records', async () => {
  const request = jest.fn(async () => ({
    items: [{ ...trip, status: 'COMPLETED' }],
  }));
  await setup({ request });
  expect(text()).toContain(
    'Stored trip record · no verified navigation history.',
  );
  expect(text()).not.toContain('COMPLETED');
  await press('Planned');
  expect(text()).toContain('No trips yet');
  expect(text()).not.toContain('COMPLETED');
  expect(request).toHaveBeenCalledTimes(1);
});

test.each(['PLANNED', 'ASSIGNED'])(
  '%s remains visible in Planned',
  async status => {
    await setup({
      request: jest.fn(async () => ({ items: [{ ...trip, status }] })),
    });
    await press('Planned');
    expect(text()).toContain('Public destination');
    expect(text()).toContain(status);
  },
);

test('cards show only stored metadata; details preserve ordered stops', async () => {
  await setup({ request: jest.fn(async () => ({ items: [trip] })) });
  expect(text()).toContain('Test truck');
  expect(text()).toContain('80,000 lb');
  expect(text()).not.toMatch(/132 mi|2h 18m|arrival|ETA/);
  expect(buttons('Record trip started')).toHaveLength(0);
  await press('View trip: My saved plan');
  expect(text()).toContain(
    'Public origin → Intermediate stop → Public destination',
  );
  expect(text()).toContain('Stored plan');
  expect(buttons('Calculate with current verified truck')).not.toHaveLength(0);
});

test('missing or malformed optional display metadata never fabricates values', async () => {
  await setup({
    request: jest.fn(async () => ({
      items: [
        { ...trip, createdAt: 'invalid', truckSnapshot: { heightFt: -1 } },
      ],
    })),
  });
  expect(text()).toContain('Public destination');
  expect(text()).not.toMatch(/Invalid Date|80,000|ft H/);
});

test('failed initial load shows compact retry and no false empty state', async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [] });
  await setup({ request });
  expect(text()).toContain("Trips couldn't be loaded.");
  expect(text()).not.toContain('No trips yet');
  await press('Retry trips');
  expect(text()).toContain('No trips yet');
  expect(request).toHaveBeenCalledTimes(2);
});

test('pull refresh preserves content while pending and after failure', async () => {
  const pending = deferred<unknown>();
  const request = jest
    .fn()
    .mockResolvedValueOnce({ items: [trip] })
    .mockImplementation(() => pending.promise);
  await setup({ request });
  await act(async () =>
    screen.root.findByType(ScrollView).props.refreshControl.props.onRefresh(),
  );
  expect(text()).toContain('Public destination');
  expect(
    screen.root.findByType(ScrollView).props.refreshControl.props.refreshing,
  ).toBe(true);
  await act(async () => pending.reject(new Error('offline')));
  expect(text()).toContain('Public destination');
  expect(text()).toContain('Showing last loaded trips');
  expect(text()).not.toContain('No trips yet');
});

test('foreground refresh is read only', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { request } = await setup();
  const listener = listeners.mock.calls
    .filter(c => c[0] === 'change')
    .at(-1)![1];
  await act(async () => listener('active'));
  expect(request.mock.calls).toEqual([
    ['GET', '/trips'],
    ['GET', '/trips'],
  ]);
});

test('unprovisioned guidance does not block genuine plans or imply navigation', async () => {
  const { services } = await setup({
    request: jest.fn(async () => ({ items: [trip] })),
  });
  expect(services.guidance).toBeInstanceOf(UnavailableNavigationEngine);
  expect(text()).toContain('PLANNED');
  expect(text()).not.toContain('COMPLETED');
});

test('legitimate current route enables compact save and preserves operation identity on retry', async () => {
  const request = jest.fn().mockImplementation(async method => {
    if (method === 'POST') throw new Error('offline');
    return { items: [] };
  });
  await setup({ request, currentRoute: true });
  expect(buttons('Save current route')).not.toHaveLength(0);
  await press('Save current route');
  await press('Retry same trip save');
  const saves = request.mock.calls.filter(c => c[0] === 'POST');
  expect(saves).toHaveLength(2);
  expect(saves[0]).toEqual(saves[1]);
  expect(saves[0][2]).toMatchObject({
    truckId: truck.id,
    expectedTruckRevision: truck.revision,
    stops: trip.stops,
  });
});

test('fresh location is rechecked at save time', async () => {
  const { services, request } = await setup({ currentRoute: true });
  (services.location.getFreshFix as jest.Mock).mockReturnValue(null);
  await press('Save current route');
  expect(request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
});

test('cancel is hidden in More and requires confirmation; dismissing sends no update', async () => {
  const { request } = await setup({
    request: jest.fn(async () => ({ items: [trip] })),
  });
  expect(buttons('Cancel / reject trip')).toHaveLength(0);
  await press('More: My saved plan');
  await press('Cancel / reject trip');
  expect(text()).toContain('Confirm only what actually occurred.');
  await press('Keep current status');
  expect(request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
  await press('More: My saved plan');
  await press('Cancel / reject trip');
  await press('Confirm trip update');
  expect(request).toHaveBeenCalledWith('PATCH', '/trips/trip-test/status', {
    expectedRevision: 3,
    status: 'CANCELLED',
  });
  expect(buttons('Delete')).toHaveLength(0);
});

test.each(['day', 'night'] as const)(
  '%s uses existing saved theme and scroll clearance for long/multiple trips',
  async mode => {
    const long = 'Long public destination name '.repeat(8);
    await setup({
      mode,
      request: jest.fn(async () => ({
        items: Array.from({ length: 12 }, (_, i) => ({
          ...trip,
          id: String(i),
          name: 'Trip ' + i,
          destination: { ...trip.destination, name: long },
        })),
      })),
    });
    expect(buttons('View trip: Trip 11')).not.toHaveLength(0);
    const scroller = screen.root.findByType(ScrollView);
    expect(StyleSheet.flatten(scroller.props.style).backgroundColor).toBe(
      mode === 'day' ? '#F3F5F7' : '#0C131B',
    );
    expect(
      StyleSheet.flatten(scroller.props.contentContainerStyle).paddingBottom,
    ).toBeGreaterThanOrEqual(28);
    const heading = screen.root
      .findAllByType(Text)
      .find(n => [n.props.children].flat(Infinity).join('').includes(long))!;
    expect(heading.props.numberOfLines).toBeUndefined();
  },
);

test('route safety and complete plan data gate saving', async () => {
  const { services } = await setup({ currentRoute: true });
  for (const invalid of [
    {
      route: { ...route(), navigationAllowed: false },
      plan: { destination: trip.destination, stops: [] },
    },
    { route: route(), plan: null },
    { route: null, plan: { destination: trip.destination, stops: [] } },
  ]) {
    await act(async () => (services.routes as any).publish(invalid));
    expect(buttons('Save current route')).toHaveLength(0);
  }
});

test('provider rejection keeps details open and never navigates to a successful route', async () => {
  const { services, onMap } = await setup({
    request: jest.fn(async () => ({ items: [trip] })),
  });
  (services.routes.calculate as jest.Mock).mockResolvedValue(false);
  await press('View trip: My saved plan');
  await press('Calculate with current verified truck');
  expect(onMap).not.toHaveBeenCalled();
  expect(buttons('Calculate with current verified truck')).not.toHaveLength(0);
});

test.each(['Recent', 'Saved', 'Planned'])(
  '%s uses the approved empty wording and one primary CTA',
  async tab => {
    await setup();
    await press(tab);
    expect(text()).toContain('No trips yet');
    expect(text()).toContain('Your saved and planned trips will appear here.');
    expect(screen.root.findAllByType(DriverButton)).toHaveLength(1);
    expect(buttons('Save current route')).toHaveLength(0);
    expect(buttons('Refresh trips')).toHaveLength(0);
  },
);

test('Saved lists persisted driver plans, without converting assignments or reported history into saved plans', async () => {
  const request = jest.fn(async () => ({
    items: [
      trip,
      {
        ...trip,
        id: 'assigned',
        name: 'Fleet assignment',
        assigned: true,
        status: 'ASSIGNED',
      },
      {
        ...trip,
        id: 'reported',
        name: 'Reported history',
        status: 'COMPLETED',
      },
    ],
  }));
  await setup({ request });
  await press('View saved trips');
  expect(buttons('Saved')[0]?.props.accessibilityState.selected).toBe(true);
  expect(buttons('View trip: My saved plan').length).toBeGreaterThan(0);
  expect(buttons('View trip: Fleet assignment')).toHaveLength(0);
  expect(buttons('View trip: Reported history')).toHaveLength(0);
  await press('Planned');
  expect(buttons('View trip: Fleet assignment').length).toBeGreaterThan(0);
  expect(request).toHaveBeenCalledTimes(1);
});

test.each(['STARTED', 'IN_PROGRESS', 'COMPLETED'])(
  'driver-reported %s is never promoted to navigation history',
  async status => {
    await setup({
      request: jest.fn(async () => ({
        items: [
          {
            ...trip,
            status,
            navigationVerified: false,
            progressSource: 'DRIVER_REPORTED',
            completedAt: '2026-09-17T12:00:00Z',
            distanceMiles: 132,
            durationSeconds: 8280,
          },
        ],
      })),
    });
    expect(text()).toContain('TRIP RECORD');
    expect(text()).not.toContain(status);
    expect(text()).not.toMatch(/132|8280|2h 18m|arrival/);
    await press('View trip: My saved plan');
    expect(text()).not.toContain(status);
    expect(text()).toContain('not verified navigation');
  },
);

test('secondary quick planning action opens the existing planner without any provider request', async () => {
  const { onMap, request } = await setup();
  await press('Build a new route');
  expect(onMap).toHaveBeenCalledTimes(1);
  expect(request.mock.calls).toEqual([['GET', '/trips']]);
});
