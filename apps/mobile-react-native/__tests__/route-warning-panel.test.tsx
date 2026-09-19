import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RouteAdvisories } from '../src/features/navigation/RouteAdvisories';
import { DriverSheet } from '../src/components/DriverSheet';
import type { Services } from '../src/app/services';
import { route } from './fixtures';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
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
test('warning details live in a separate panel, preserve loaded evidence, and never refresh automatically', async () => {
  const now = Date.now();
  const accepted = {
    ...route(),
    routeGeometry: [
      [-100, 40],
      [-99.98, 40],
    ] as [number, number][],
  };
  const fix = {
    latitude: 40,
    longitude: -99.999,
    accuracy: 5,
    timestamp: now,
    speed: 0,
    heading: 90,
  };
  const corridor = jest.fn(async (kind: string) =>
    kind === 'restrictions'
      ? [
          {
            id: 'closure',
            title: 'Test restriction',
            source: 'TEST_ONLY',
            observedAt: new Date(now).toISOString(),
            routeDistanceAheadMeters: 500,
            severity: 'HIGH',
          },
        ]
      : [],
  );
  const services = {
    location: { getFreshFix: () => fix },
    routes: { getSnapshot: () => ({ route: accepted }) },
    poi: { corridor },
  } as unknown as Services;
  const close = jest.fn(),
    open = jest.fn();
  const view = (expanded: boolean) => (
    <RouteAdvisories
      services={services}
      route={accepted}
      fix={fix}
      expanded={expanded}
      onClose={close}
      onOpen={open}
    />
  );
  await act(async () => {
    screen = create(view(false));
  });
  expect(screen.toJSON()).toBeNull();
  expect(corridor).not.toHaveBeenCalled();
  await act(async () => screen.update(view(true)));
  expect(screen.root.findAllByType(DriverSheet)).toHaveLength(1);
  expect(corridor).not.toHaveBeenCalled();
  const press = (label: string) =>
    screen.root
      .findAll(
        n =>
          n.props.accessibilityLabel === label &&
          typeof n.props.onPress === 'function',
      )[0]!
      .props.onPress();
  await act(async () => press('Refresh road warnings'));
  expect(corridor).toHaveBeenCalledTimes(2);
  expect(text()).toContain('Test restriction');
  await act(async () => press('Close road warnings'));
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => screen.update(view(false)));
  expect(screen.root.findAllByType(DriverSheet)).toHaveLength(0);
  expect(text()).toContain('HIGH');
  expect(text()).toContain('Test restriction');
  expect(text()).not.toContain('Refresh road warnings');
  await act(async () => press('Review route warnings'));
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => screen.update(view(true)));
  expect(text()).toContain('Test restriction');
  expect(corridor).toHaveBeenCalledTimes(2);
});
