import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DeviceEventEmitter } from 'react-native';
import { CopilotTruckMap } from '../src/features/map/CopilotTruckMap';
import type { Poi } from '../src/features/poi/PoiService';
const mockHost = {
  setMapAppearance: jest.fn().mockResolvedValue(undefined),
  drawRoutePreview: jest.fn().mockResolvedValue(undefined),
  drawMarkers: jest.fn().mockResolvedValue(undefined),
  mapCommand: jest.fn().mockResolvedValue(undefined),
  mapFrame: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => mockHost,
}));
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotState: () => ({ readyToAddStops: true }),
}));
jest.mock('../src/components/CopilotOfflineMap', () => ({
  copilotMapBlocker: () => null,
  CopilotOfflineMap: () => require('react').createElement('VerifiedCoPilotMap'),
}));
let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.clearAllMocks();
});
test('native coordinate picks validate range before reverse lookup', async () => {
  const choose = jest.fn();
  await act(async () => {
    screen = create(
      <CopilotTruckMap
        route={null}
        plan={null}
        fix={null}
        pois={[]}
        onCoordinate={choose}
      />,
    );
  });
  await act(async () => {
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', { lat: 91, lng: 0 });
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', {
      lat: '40',
      lng: -120,
    });
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', { lat: 40, lng: -120 });
  });
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith({ lat: 40, lng: -120 });
});
test('late marker events cannot select a replacement POI', async () => {
  const choose = jest.fn();
  const first = {
    id: 'first',
    name: 'First',
    latitude: 40,
    longitude: -120,
  } as Poi;
  const second = { ...first, id: 'second', name: 'Second' };
  const render = (pois: Poi[]) => (
    <CopilotTruckMap
      route={null}
      plan={null}
      fix={null}
      pois={pois}
      onPoi={choose}
    />
  );
  await act(async () => {
    screen = create(render([first]));
  });
  const old = mockHost.drawMarkers.mock.calls.at(-1)![0][0].id;
  await act(async () => screen.update(render([second])));
  const current = mockHost.drawMarkers.mock.calls.at(-1)![0][0].id;
  await act(async () => {
    DeviceEventEmitter.emit('SemiTraxCoPilotMarkerPicked', { id: old });
    DeviceEventEmitter.emit('SemiTraxCoPilotMarkerPicked', { id: current });
  });
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith(second);
});

test('settings retain control of the native view and ignore planner coordinate picks', async () => {
  const choose = jest.fn();
  const render = (settingsOpen: boolean) => (
    <CopilotTruckMap
      route={null}
      plan={null}
      fix={null}
      pois={[]}
      settingsOpen={settingsOpen}
      onCoordinate={choose}
    />
  );
  await act(async () => {
    screen = create(render(false));
  });
  jest.clearAllMocks();
  await act(async () => screen.update(render(true)));
  await act(async () => {
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', { lat: 40, lng: -120 });
  });
  expect(choose).not.toHaveBeenCalled();
  expect(mockHost.drawRoutePreview).not.toHaveBeenCalled();
  expect(mockHost.setMapAppearance).not.toHaveBeenCalled();
  expect(mockHost.drawMarkers).not.toHaveBeenCalled();
  await act(async () => screen.update(render(false)));
  expect(mockHost.drawRoutePreview).toHaveBeenCalledWith([]);
  expect(mockHost.setMapAppearance).toHaveBeenCalledTimes(1);
});

test('active guidance never invokes the native preview cleanup', async () => {
  await act(async () => {
    screen = create(
      <CopilotTruckMap
        route={null}
        plan={null}
        fix={null}
        pois={[]}
        navigationActive
      />,
    );
  });
  expect(mockHost.drawRoutePreview).not.toHaveBeenCalled();
});

test('failed orientation command does not change the compass state', async () => {
  await act(async () => {
    screen = create(
      <CopilotTruckMap route={null} plan={null} fix={null} pois={[]} />,
    );
  });
  mockHost.mapCommand.mockRejectedValueOnce(new Error('unavailable'));
  const compass = () =>
    screen.root.findByProps({ accessibilityLabel: 'Compass / north up' });
  await act(async () => {
    await compass().props.onPress();
  });
  await act(async () => {
    await compass().props.onPress();
  });
  expect(mockHost.mapCommand.mock.calls.map(call => call[0])).toEqual([
    'heading-up',
    'heading-up',
  ]);
});


test('native map stays mounted while appearance prepares and while settings owns it', async () => {
  let finish!: () => void;
  mockHost.setMapAppearance.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const render = (settingsOpen: boolean) => <CopilotTruckMap route={null} plan={null} fix={null} pois={[]} settingsOpen={settingsOpen} />;
  await act(async () => { screen = create(render(false)); });
  const native = screen.root.findByType('VerifiedCoPilotMap' as never);
  await act(async () => { finish(); });
  expect(screen.root.findByType('VerifiedCoPilotMap' as never)).toBe(native);
  await act(async () => { screen.update(render(true)); });
  expect(screen.root.findByType('VerifiedCoPilotMap' as never)).toBe(native);
});

test('preview failure is retryable and success removes the stale error', async () => {
  mockHost.drawRoutePreview.mockRejectedValueOnce(new Error('not ready'));
  await act(async () => { screen = create(<CopilotTruckMap route={null} plan={null} fix={null} pois={[]} />); });
  const retry = screen.root.findByProps({accessibilityLabel: 'Retry route preview'});
  await act(async () => { retry.props.onPress(); });
  expect(mockHost.drawRoutePreview).toHaveBeenCalledTimes(2);
  expect(screen.root.findAllByProps({accessibilityLabel: 'Retry route preview'})).toHaveLength(0);
});
