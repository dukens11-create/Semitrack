import React from 'react';
import { AppState, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DrivingNearbyOverlay } from '../src/features/navigation/DrivingNearbyOverlay';
import {
  drivingHeading,
  providerExit,
  visibleNearby,
  type NearbyCache,
} from '../src/features/navigation/drivingNearby';
const now = 1700000000000;
const fix = {
  latitude: 40,
  longitude: -120,
  accuracy: 5,
  timestamp: now,
  heading: 45,
  speed: 20,
};
const batch = (category: string) => ({
  observedAt: now,
  latitude: 40,
  longitude: -120,
  items: [1, 3, 2].map(i => ({
    id: category + i,
    name: category + i,
    category,
    provider: 'copilot',
    latitude: 40 + i / 100,
    longitude: -120,
  })),
});
const cache: NearbyCache = {
  truck_stop: batch('truck_stop'),
  rest_area: batch('rest_area'),
  weigh_station: batch('weigh_station'),
};
test('selects two nearest truck stops and one weigh station and rest area, recomputing miles', () => {
  const rows = visibleNearby(cache, fix, now);
  expect(rows.map(row => row.poi?.id)).toEqual([
    'truck_stop1',
    'truck_stop2',
    'weigh_station1',
    'rest_area1',
  ]);
  expect(rows[0]?.miles).toBeCloseTo(0.691, 2);
  expect(
    visibleNearby(cache, { ...fix, latitude: 40.019 }, now)[0]?.poi?.id,
  ).toBe('truck_stop2');
});
test('stale GPS, old batches and large movement suppress distances', () => {
  expect(
    visibleNearby(cache, fix, now + 16000).every(
      row => row.miles === undefined,
    ),
  ).toBe(true);
  expect(
    visibleNearby(
      cache,
      { ...fix, timestamp: now + 121000 },
      now + 121000,
    ).every(row => row.miles === undefined),
  ).toBe(true);
  expect(
    visibleNearby(cache, { ...fix, latitude: 41 }, now).every(
      row => row.miles === undefined,
    ),
  ).toBe(true);
});
test('compass normalizes north and hides stale heading; exits require explicit source', () => {
  expect(drivingHeading(fix, now)?.label).toBe('NE');
  expect(drivingHeading({ ...fix, heading: 360 }, now)?.label).toBe('N');
  expect(drivingHeading(fix, now + 16000)).toBeUndefined();
  const poi = cache.truck_stop!.items[0]!;
  expect(
    providerExit({ ...poi, name: 'Exit 42 Travel Center', exitNumber: '42' }),
  ).toBeUndefined();
  expect(
    providerExit({ ...poi, exitNumber: '42b', exitSource: 'provider' }),
  ).toBe('42B');
});
let screen: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers({ now });
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
});
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.useRealTimers();
});
test('shows all four driving rows, miles and unavailable exits without starting navigation', async () => {
  const service = {
    nearby: jest.fn(async (category: string) => batch(category).items),
  };
  await act(async () => {
    screen = create(
      <DrivingNearbyOverlay
        service={service}
        fix={fix}
        active
        availableHeight={300}
      />,
    );
  });
  const text = screen!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
  expect(service.nearby).toHaveBeenCalledTimes(3);
  expect(text).toContain('NE');
  expect(text).toContain('Straight-line mi');
  expect(text).toContain('Truck stop 1');
  expect(text).toContain('Truck stop 2');
  expect(text).toContain('Weigh station');
  expect(text).toContain('Rest area');
  expect(text).toContain('Exit —');
  await act(async () => jest.advanceTimersByTime(10000));
  expect(service.nearby).toHaveBeenCalledTimes(3);
});
test('inactive screen makes no search and short viewport collapses instead of covering map', async () => {
  const service = {
    nearby: jest.fn(async (category: string) => batch(category).items),
  };
  await act(async () => {
    screen = create(
      <DrivingNearbyOverlay
        service={service}
        fix={fix}
        active={false}
        availableHeight={300}
      />,
    );
  });
  expect(service.nearby).not.toHaveBeenCalled();
  await act(async () => {
    screen!.update(
      <DrivingNearbyOverlay
        service={service}
        fix={fix}
        active
        availableHeight={100}
      />,
    );
  });
  expect(
    screen!.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' '),
  ).not.toContain('Truck stop 1');
});
