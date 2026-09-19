import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, ScrollView, StyleSheet, Text } from 'react-native';
import { DriverDashboardScreen } from '../src/screens/DriverDashboardScreen';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { DriverIcon } from '../src/components/DriverIcon';
import { DriverButton } from '../src/components/DriverUI';
import { UnavailableNavigationEngine } from '../src/services/guidance/NavigationEngine';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import { truck, user } from './fixtures';
let screen: ReactTestRenderer;
const originalWindow = Dimensions.get('window'),
  originalScreen = Dimensions.get('screen');
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});
const content = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const button = (label: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
async function setup({
  mode = 'day',
  selected = truck,
  name = user.fullName,
}: {
  mode?: 'day' | 'night';
  selected?: typeof truck | null;
  name?: string;
} = {}) {
  // Account/profile snapshots only: no mocked successful provider responses.
  const services = {
    auth: new Store({ status: 'signedIn', user: { ...user, fullName: name } }),
    trucks: new Store({ profiles: selected ? [selected] : [], selected }),
    guidance: new UnavailableNavigationEngine(),
  } as unknown as Services;
  const actions = {
    onMap: jest.fn(),
    onTrips: jest.fn(),
    onDocs: jest.fn(),
    onMore: jest.fn(),
    onTrucks: jest.fn(),
  };
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <DriverDashboardScreen services={services} {...actions} />
      </DriverAppearanceContext.Provider>,
    );
  });
  return { services, actions };
}
test('departure card renders the actual selected profile rather than screenshot values', async () => {
  await setup({
    selected: {
      ...truck,
      name: 'Regional truck',
      heightFt: 12.75,
      widthFt: 8,
      lengthFt: 48,
      weightLbs: 64000,
      axleCount: 4,
    },
  });
  expect(content()).toContain('Regional truck · Active');
  expect(content()).toContain('12.75 ft H · 8 ft W · 48 ft L');
  expect(content()).toContain('64,000 lb · 4 axles');
  expect(content()).not.toContain('80,000 lb');
  expect(content()).not.toContain('HAZMAT');
});
test('missing profile is explicit and still allows review without invented dimensions', async () => {
  const { actions } = await setup({ selected: null });
  expect(content()).toContain('No active truck profile');
  expect(content()).toContain('Add and verify your truck before routing.');
  expect(content()).not.toContain('ft H');
  await act(async () => button('Review truck profile').props.onPress());
  expect(actions.onTrucks).toHaveBeenCalledTimes(1);
});
test.each([
  ['Choose destination', 'onMap'],
  ['Trips', 'onTrips'],
  ['Documents', 'onDocs'],
  ['My truck', 'onTrucks'],
  ['Review truck profile', 'onTrucks'],
  ['Open More', 'onMore'],
] as const)('%s preserves its existing action', async (label, action) => {
  const { actions } = await setup();
  await act(async () => button(label).props.onPress());
  expect(actions[action]).toHaveBeenCalledTimes(1);
});
test.each(['day', 'night'] as const)(
  '%s palette has semantic shortcuts and readable compact safety rows',
  async mode => {
    await setup({ mode });
    const trips = button('Trips'),
      docs = button('Documents'),
      myTruck = button('My truck');
    expect(trips.findByType(DriverIcon).props.color).toBe(
      mode === 'day' ? '#0969B6' : '#7CC4FF',
    );
    expect(docs.findByType(DriverIcon).props.color).toBe(
      mode === 'day' ? '#475569' : '#C0CDDC',
    );
    expect(myTruck.findByType(DriverIcon).props.color).toBe('#FF6B2C');
    expect(StyleSheet.flatten(trips.props.style).backgroundColor).toBe(
      mode === 'day' ? '#FFFFFF' : '#17212C',
    );
    expect(content()).toContain('Truck-safe routing');
    for (const label of [
      'Clearance and size restrictions',
      'Weight, axle and restricted roads',
      'Road conditions and alerts',
    ])
      expect(content()).toContain(label);
    expect(screen.root.findAllByType(DriverButton)).toHaveLength(1);
  },
);
test('unprovisioned guidance does not disable local shortcuts or create live-provider claims', async () => {
  const { services } = await setup();
  expect(services.guidance.getNavigationState().phase).not.toBe('navigating');
  for (const label of [
    'Choose destination',
    'Trips',
    'Documents',
    'My truck',
    'Review truck profile',
  ])
    expect(button(label).props.disabled).not.toBe(true);
  expect(content()).not.toMatch(
    /live DOT|live road|navigation is verified|restrictions are verified/,
  );
  expect(content()).not.toContain('Safety checks require');
});
test('long driver name remains complete and can wrap instead of being clamped', async () => {
  const first = 'AlexandertheLongDriverName';
  await setup({ name: first + ' Lastname' });
  expect(content()).toContain('Ready to roll, ' + first + '?');
  const greeting = screen.root
    .findAllByType(Text)
    .find(n =>
      [n.props.children].flat().join('').startsWith('Ready to roll,'),
    )!;
  expect(greeting.props.numberOfLines).toBeUndefined();
  expect(greeting.props.allowFontScaling).not.toBe(false);
});
test.each([
  [320, 1],
  [320, 2],
  [412, 1],
  [412, 2],
])(
  'width %i font scale %i preserves scrolling, scalable text and equal shortcut sizing',
  async (width, fontScale) => {
    Dimensions.set({
      window: { width, height: 640, scale: 3, fontScale },
      screen: { width, height: 640, scale: 3, fontScale },
    });
    await setup();
    expect(screen.root.findAllByType(ScrollView).length).toBeGreaterThan(0);
    const layouts = ['Trips', 'Documents', 'My truck'].map(label =>
      StyleSheet.flatten(button(label).props.style),
    );
    for (const style of layouts) {
      expect(style.flex).toBe(1);
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.height).toBeUndefined();
    }
    for (const label of ['Trips', 'Documents', 'My truck']) {
      const text = button(label)
        .findAllByType(Text)
        .find(n => n.props.children === label)!;
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.allowFontScaling).not.toBe(false);
    }
  },
);
