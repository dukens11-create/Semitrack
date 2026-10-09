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
  useCopilotState: () => ({}),
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
