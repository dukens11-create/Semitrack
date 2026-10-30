import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Switch } from 'react-native';
import { CoPilotFeatureControls } from '../src/components/CoPilotFeatureControls';
import { DriverButton } from '../src/components/DriverUI';
const mockRead = jest.fn(),
  mockWrite = jest.fn(),
  mockPlaces = jest.fn(),
  mockVisible = jest.fn();
jest.mock('../src/services/copilot/EnginePreferences', () => ({
  enginePreferences: { speedAlert: { label: 'Speed alerts' } },
  readEnginePreference: (...args: unknown[]) => mockRead(...args),
  writeEnginePreference: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock('../src/services/copilot/CoPilotPlaces', () => ({
  readCoPilotPlaces: () => mockPlaces(),
  setCoPilotPlaceVisible: (...args: unknown[]) => mockVisible(...args),
}));
let tree: ReactTestRenderer;
beforeEach(() => {
  AppState.currentState = 'active';
  jest.clearAllMocks();
  mockRead.mockResolvedValue(true);
  mockWrite.mockResolvedValue(false);
  mockPlaces.mockResolvedValue([{ id: 7, name: 'Truck Stops', visible: true }]);
  mockVisible.mockResolvedValue([]);
});
afterEach(() => {
  act(() => tree.unmount());
});
async function open() {
  await act(async () => {
    tree = create(<CoPilotFeatureControls />);
  });
  await act(async () => {
    tree.root.findAllByType(DriverButton)[0]!.props.onPress();
  });
}
test('reads engine settings and POI categories, then verifies a changed setting', async () => {
  await open();
  expect(tree.root.findAllByType(Switch)[0]!.props.value).toBe(true);
  mockRead.mockResolvedValue(false);
  await act(async () => {
    tree.root.findAllByType(Switch)[0]!.props.onValueChange(false);
  });
  expect(mockWrite).toHaveBeenCalledWith('speedAlert', false);
  expect(tree.root.findAllByType(Switch)[0]!.props.value).toBe(false);
  await act(async () => {
    tree.root.findAllByType(Switch)[1]!.props.onValueChange(false);
  });
  expect(mockVisible).toHaveBeenCalledWith(7, false);
});
test('failed writes clear unconfirmed state and disable toggles', async () => {
  await open();
  mockWrite.mockRejectedValueOnce(new Error('unconfirmed'));
  await act(async () => {
    tree.root.findAllByType(Switch)[0]!.props.onValueChange(false);
  });
  expect(tree.root.findAllByType(Switch)[0]!.props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('did not confirm');
});
test('disabled setup never reads or changes native preferences', async () => {
  await act(async () => {
    tree = create(<CoPilotFeatureControls disabled />);
  });
  expect(tree.root.findAllByType(DriverButton)[0]!.props.disabled).toBe(true);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockPlaces).not.toHaveBeenCalled();
});
