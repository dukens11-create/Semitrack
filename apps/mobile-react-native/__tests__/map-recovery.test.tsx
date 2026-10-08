import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { TruckMap } from '../src/features/map/TruckMap';
import { route } from './fixtures';

const mockFitBounds = jest.fn();
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    MapView: 'NativeMapView',
    Camera: require('react').forwardRef((props: unknown, ref: unknown) => {
      require('react').useImperativeHandle(ref, () => ({
        setCamera: jest.fn(),
        fitBounds: mockFitBounds,
      }));
      return require('react').createElement('Camera', props);
    }),
    ShapeSource: 'ShapeSource',
    LineLayer: 'LineLayer',
    StyleURL: { Street: 'street', Dark: 'dark' },
  },
}));
let screen: ReactTestRenderer;
const map = () =>
  screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!;
const retry = () =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Retry map' &&
      typeof n.props.onPress === 'function',
  )[0]!;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
async function mount(token = 'pk.fixture') {
  await act(async () => {
    screen = create(
      <TruckMap
        token={token}
        route={route()}
        plan={null}
        fix={null}
        pois={[]}
        command={{ type: 'overview', id: 1 }}
      />,
    );
  });
}
test('a loading error can be retried without reopening the app or losing the route overview', async () => {
  await mount();
  await act(async () => map().props.onDidFinishLoadingMap());
  expect(mockFitBounds).toHaveBeenCalledTimes(1);
  await act(async () => map().props.onMapLoadingError());
  expect(map()).toBeUndefined();
  await act(async () => retry().props.onPress());
  expect(map()).toBeDefined();
  await act(async () => map().props.onDidFinishLoadingMap());
  expect(mockFitBounds).toHaveBeenCalledTimes(2);
});
test('token initialization failure also permits a successful retry', async () => {
  jest
    .mocked(Mapbox.setAccessToken)
    .mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(map()).toBeUndefined();
  await act(async () => retry().props.onPress());
  expect(map()).toBeDefined();
});
test('returning to the foreground retries a failed map and removes the recovery listener', async () => {
  let change!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      change = listener;
      return { remove };
    });
  await mount();
  await act(async () => map().props.onMapLoadingError());
  await act(async () => change('background'));
  expect(map()).toBeUndefined();
  await act(async () => change('active'));
  expect(map()).toBeDefined();
  expect(remove).toHaveBeenCalledTimes(1);
});
test('missing map configuration does not offer an ineffective retry', async () => {
  await mount('');
  expect(map()).toBeUndefined();
  expect(retry()).toBeUndefined();
  expect(Mapbox.setAccessToken).not.toHaveBeenCalled();
});
