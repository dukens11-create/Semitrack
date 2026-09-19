import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NavigationMenu } from '../src/features/navigation/NavigationMenu';
import {
  NavigationHud,
  maneuverDistance,
  maneuverSymbol,
} from '../src/features/navigation/NavigationHud';
import { RoutePoiBadges } from '../src/features/navigation/RoutePoiBadges';
import { route } from './fixtures';
import type { NavigationState } from '../src/services/guidance/NavigationEngine';
let screen: ReactTestRenderer;
const now = 1700000000000;
const fix = {
  latitude: 40,
  longitude: -100,
  accuracy: 5,
  timestamp: now,
  speed: 17.4,
  heading: 90,
};
const state: NavigationState = {
  phase: 'navigating',
  routeId: 'test-route',
  progressObservedAt: now,
  remainingMeters: 24140,
  remainingSeconds: 1500,
  guidance: {
    source: 'copilot',
    observedAt: now,
    instruction: 'Turn left onto',
    action: 'left',
    nextRoad: 'I-80 West',
    currentRoad: 'I-80 West',
    highway: 'I-80',
    maneuverMeters: 114.3,
    subsequent: 'Exit 13 to East 8th Street',
  },
};
const text = () =>
  screen.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
const buttons = () =>
  screen.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      typeof n.props.onPress === 'function',
  );
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('every screenshot quick action and driving setup tile dispatches its own supported action', async () => {
  const action = jest.fn();
  await act(async () => {
    screen = create(<NavigationMenu phase="idle" onAction={action} />);
  });
  const expected = {
    Reroute: 'reroute',
    'POI Ahead': 'places',
    'Search Places': 'search',
    Report: 'report',
    'Places Filter': 'filter',
    'Share Trip': 'share',
    'Route Options': 'options',
    'Route Overview': 'overview',
    Recenter: 'recenter',
    'Audio Settings': 'audio',
    'Truck Profile': 'truck',
    'Location status': 'location',
  };
  for (const [label, value] of Object.entries(expected)) {
    await act(async () =>
      buttons()
        .find(b => b.props.accessibilityLabel === label)!
        .props.onPress(),
    );
    expect(action).toHaveBeenLastCalledWith(value);
  }
  expect(text()).toContain('Quick actions');
  expect(text()).toContain('Driving setup');
  expect(text()).toContain('planned truck route');
});
test('maneuver symbols and sub-mile feet depend on explicit provider action and distance', () => {
  expect(maneuverSymbol('turn_left')).toBe('↰');
  expect(maneuverSymbol('right')).toBe('↱');
  expect(maneuverSymbol('straight')).toBe('↑');
  expect(maneuverSymbol()).toBe('?');
  expect(maneuverSymbol('unknown')).toBe('?');
  expect(maneuverDistance(114.3, false)).toBe('375 ft');
  expect(maneuverDistance(114.3, true)).toBe('114 m');
});
test('reference cockpit displays genuine maneuver and subsequent text and leaves unknown speed limit empty', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await act(async () => {
    screen = create(<NavigationHud route={route()} state={state} fix={fix} />);
  });
  expect(text()).toContain('Turn left onto');
  expect(text()).toContain('375 ft');
  expect(text()).toContain('I-80 West');
  expect(text()).toContain('Then');
  expect(text()).toContain('Exit 13 to East 8th Street');
  expect(text()).toContain('--');
  expect(text()).not.toContain('Provider speed limit');
  expect(text()).toContain('15.0 mi');
});
test('live missing progress cannot reuse planning totals and preview cannot reuse live maneuver', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await act(async () => {
    screen = create(
      <NavigationHud
        route={route()}
        state={{ phase: 'navigating', routeId: 'test-route' }}
        fix={null}
        placement="dashboard"
      />,
    );
  });
  expect(text()).toContain('Live ETA unavailable');
  expect(text()).not.toContain('Planning estimate');
  await act(async () =>
    screen.update(
      <NavigationHud
        route={route()}
        state={{ ...state, phase: 'unavailable' }}
        fix={null}
      />,
    ),
  );
  expect(text()).toContain('Guidance has not started');
  expect(text()).not.toContain('375 ft');
  expect(text()).not.toContain('I-80 West');
});
test('cockpit automatically clears expired guidance, ETA and GPS without another engine event', async () => {
  jest.useFakeTimers({ now });
  await act(async () => {
    screen = create(<NavigationHud route={route()} state={state} fix={fix} />);
  });
  expect(text()).toContain('375 ft');
  await act(async () => jest.advanceTimersByTime(16000));
  expect(text()).not.toContain('375 ft');
  expect(text()).not.toContain('I-80 West');
  expect(text()).toContain('Live ETA unavailable');
  expect(text()).toContain('GPS speed unavailable');
});
test('More and route summary retain separate controls', async () => {
  const more = jest.fn(),
    review = jest.fn();
  await act(async () => {
    screen = create(
      <NavigationHud
        route={route()}
        state={{ phase: 'idle' }}
        fix={null}
        placement="dashboard"
        onMore={more}
        onReview={review}
      />,
    );
  });
  await act(async () =>
    buttons()
      .find(n => n.props.accessibilityLabel === 'Navigation Controls')!
      .props.onPress(),
  );
  expect(more).toHaveBeenCalledTimes(1);
  expect(review).not.toHaveBeenCalled();
  await act(async () =>
    buttons()
      .find(n => n.props.accessibilityLabel === 'Review route and stops')!
      .props.onPress(),
  );
  expect(review).toHaveBeenCalledTimes(1);
});
test('POI badges need fresh sourced ahead evidence and a real fresh fix; no sample logos are inserted', async () => {
  jest.useFakeTimers({ now });
  const select = jest.fn();
  const poi = {
    id: 'poi',
    name: 'Test truck stop',
    latitude: 40,
    longitude: -100,
    provider: 'TEST_ONLY',
    observedAt: new Date(now).toISOString(),
    routeDistanceAheadMeters: 1000,
  };
  await act(async () => {
    screen = create(
      <RoutePoiBadges
        pois={[
          poi,
          {
            ...poi,
            id: 'stale',
            name: 'Stale',
            observedAt: new Date(now - 20000).toISOString(),
          },
          { ...poi, id: 'unknown', name: 'Unknown source', provider: '' },
        ]}
        fix={fix}
        metric={false}
        onSelect={select}
      />,
    );
  });
  expect(text()).toContain('Test truck stop');
  expect(text()).not.toContain('Stale');
  expect(text()).not.toContain('Unknown source');
  await act(async () => buttons()[0]!.props.onPress());
  expect(select).toHaveBeenCalledWith(poi);
  await act(async () => jest.advanceTimersByTime(16000));
  expect(screen.toJSON()).toBeNull();
});

test('preview keeps the compact destination and shows LIMIT and MPH without a fake maneuver or speed limit', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const destination = 'Reno Junction, California, United States';
  await act(async () => {
    screen = create(
      <NavigationHud
        route={route()}
        destination={destination}
        state={{ phase: 'unavailable' }}
        fix={fix}
      />,
    );
  });
  expect(
    screen.root.findAll(n => n.props.testID === 'route-preview-card').length,
  ).toBeGreaterThan(0);
  expect(text()).toContain(destination);
  expect(text()).toContain('Trimble estimate');
  expect(text()).toContain('Guidance has not started');
  expect(text()).toContain('LIMIT');
  expect(text()).toContain('MPH');
  expect(text()).toContain('--');
  expect(text()).toContain('39');
  expect(text()).not.toContain('375 ft');
  expect(text()).not.toContain('Provider speed limit');
});
