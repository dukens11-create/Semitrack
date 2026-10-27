import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DeviceEventEmitter } from 'react-native';
import { CopilotPlannerMap } from '../src/features/map/CopilotPlannerMap';
import { CopilotOfflineMap } from '../src/components/CopilotOfflineMap';
import type { TruckRoute } from '../src/models/contracts';
import type { Poi } from '../src/features/poi/PoiService';
const mockHost = {
  setMapAppearance: jest.fn(),
  drawRoutePreview: jest.fn(),
  mapFrame: jest.fn(),
  drawMarkers: jest.fn(),
  mapCommand: jest.fn(),
};
let mockBlocker: string | null = null;
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => mockHost,
}));
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotState: () => ({}),
}));
jest.mock('../src/components/CopilotOfflineMap', () => ({
  CopilotOfflineMap: () => null,
  copilotMapBlocker: () => mockBlocker,
}));
const route = {
  routeGeometry: [
    [-120, 39],
    [-119, 40],
  ],
} as TruckRoute;
const poi = {
  id: 'stop',
  name: 'Truck stop',
  latitude: 39,
  longitude: -120,
} as Poi;
let tree: ReactTestRenderer;
beforeEach(() => {
  mockBlocker = null;
  Object.values(mockHost).forEach(fn =>
    fn.mockReset().mockResolvedValue(undefined),
  );
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
});
test('draws planning geometry on CoPilot and forwards verified map interactions', async () => {
  const picked = jest.fn(),
    coordinate = jest.fn();
  await act(async () => {
    tree = create(
      <CopilotPlannerMap
        route={route}
        plan={null}
        pois={[poi]}
        onPoi={picked}
        onCoordinate={coordinate}
      />,
    );
  });
  expect(tree.root.findAllByType(CopilotOfflineMap)).toHaveLength(1);
  expect(mockHost.drawRoutePreview).toHaveBeenCalledWith(route.routeGeometry);
  expect(mockHost.mapFrame).toHaveBeenCalledWith(-120, 39, -119, 40);
  expect(mockHost.drawMarkers).toHaveBeenCalledWith([
    { id: 0, lat: 39, lng: -120 },
  ]);
  act(() => {
    DeviceEventEmitter.emit('SemiTraxCoPilotMarkerPicked', { id: 0 });
    DeviceEventEmitter.emit('SemiTraxCoPilotMarkerPicked', { id: -1 });
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', { lat: 39, lng: -120 });
    DeviceEventEmitter.emit('SemiTraxCoPilotMapPicked', {
      lat: 1000,
      lng: -120,
    });
  });
  expect(picked).toHaveBeenCalledTimes(1);
  expect(picked).toHaveBeenCalledWith(poi);
  expect(coordinate).toHaveBeenCalledTimes(1);
  expect(mockHost.mapCommand).not.toHaveBeenCalledWith('native-map');
});
test('unverified setup never issues native display mutations', async () => {
  mockBlocker = 'Maps not verified';
  await act(async () => {
    tree = create(<CopilotPlannerMap route={route} plan={null} pois={[]} />);
  });
  Object.values(mockHost).forEach(fn => expect(fn).not.toHaveBeenCalled());
});
test('unmount during appearance setup prevents late route and marker writes', async () => {
  let finish!: () => void;
  mockHost.setMapAppearance.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    tree = create(<CopilotPlannerMap route={route} plan={null} pois={[poi]} />);
  });
  act(() => tree.unmount());
  await act(async () => {
    finish();
  });
  expect(mockHost.drawRoutePreview).not.toHaveBeenCalled();
  expect(mockHost.drawMarkers).not.toHaveBeenCalled();
});
