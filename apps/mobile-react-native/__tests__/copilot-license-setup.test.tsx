import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CoPilotDeviceSetup } from '../src/components/CoPilotDeviceSetup';
import { amsSetupExplanation } from '../src/services/copilot/CopilotLicenseDiagnostics';

let mockFull = false;
let mockTruck = false;
const mockDiagnostics = jest.fn();
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => ({ setupDiagnostics: mockDiagnostics }),
}));
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotState: () => ({
    licensingReady: true,
    fullNavigationLicensed: mockFull,
    heavyTruckLicensed: mockTruck,
    mapsReady: false,
    operation: 'license-entitlements',
    error: 'COPILOT_LICENSE_PROVISIONING_REQUIRED',
  }),
  useCopilotSetup: () => ({ cellularAllowed: false }),
}));
jest.mock('../src/components/DriverUI', () => ({
  useDriverPalette: () => ({ text: '#000', muted: '#555' }),
}));
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test.each([[false, false], [true, false], [false, true]])(
  'missing entitlements (%s, %s) explain the device limit and hide downloads',
  async (full, truck) => {
    mockFull = full;
    mockTruck = truck;
    mockDiagnostics.mockResolvedValue({
      loginResponse: 'FAILED_LOGIN_DEVICE_LIMIT_REACHED',
    });
    await act(async () => { tree = create(<CoPilotDeviceSetup />); });
    expect(JSON.stringify(tree.toJSON())).toContain('Trimble has reached the device limit');
    expect(tree.root.findAllByProps({
      accessibilityLabel: 'Download SemiTraX maps using mobile data',
    })).toHaveLength(0);
  },
);
test('verified licenses allow map setup without presenting an old callback as current failure', async () => {
  mockFull = true;
  mockTruck = true;
  mockDiagnostics.mockResolvedValue({
    loginResponse: 'FAILED_LOGIN_DEVICE_LIMIT_REACHED',
  });
  await act(async () => { tree = create(<CoPilotDeviceSetup />); });
  expect(JSON.stringify(tree.toJSON())).not.toContain('Trimble has reached the device limit');
  expect(tree.root.findAllByProps({
    accessibilityLabel: 'Download SemiTraX maps using mobile data',
  }).length).toBeGreaterThan(0);
});
test('unknown diagnostic responses are not rendered as advice', () => {
  expect(amsSetupExplanation('license-entitlements', 'private exception')).toBeNull();
  expect(amsSetupExplanation('license-entitlements', 'SUCCESS')).toBeNull();
});
