import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CoPilotMapCatalog } from '../src/components/CoPilotMapCatalog';
import { Button } from '../src/components/ui';
const mockHost = {
  licensedMapCatalog: jest.fn().mockResolvedValue([
    { name: 'NORTH_AMERICA_California', installed: true },
    { name: 'NORTH_AMERICA_Nevada', installed: false },
    { name: 'NORTH_AMERICA_United_States', installed: false },
  ]),
  downloadLicensedRegions: jest.fn().mockResolvedValue('SUCCESS'),
};
jest.mock('../src/services/copilot/CoPilotHost', () => ({ coPilotHost: () => mockHost }));
let screen: ReactTestRenderer;
afterEach(async () => { await act(async () => screen.unmount()); jest.clearAllMocks(); });
test('downloads only explicit selections with cellular off and verifies installed status separately', async () => {
  await act(async () => { screen = create(<CoPilotMapCatalog />); });
  const button = (title: string) => screen.root.findAllByType(Button).find(node => node.props.title === title)!;
  await act(async () => button('Refresh licensed and installed maps').props.onPress());
  expect(button('Installed: NORTH AMERICA California').props.disabled).toBe(true);
  await act(async () => button('Select: NORTH AMERICA United States').props.onPress());
  await act(async () => button('Download selected licensed maps').props.onPress());
  expect(mockHost.downloadLicensedRegions).toHaveBeenCalledWith(['NORTH_AMERICA_United_States'], false);
  expect(button('Selected: NORTH AMERICA United States')).toBeDefined();
  expect(JSON.stringify(screen.toJSON())).toContain('Download request accepted');
});

test('shows a visible dialog when the native download rejects', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockHost.downloadLicensedRegions.mockRejectedValueOnce(new Error('No active route allowed'));
  await act(async () => { screen = create(<CoPilotMapCatalog />); });
  const button = (title: string) => screen.root.findAllByType(Button).find(node => node.props.title === title)!;
  await act(async () => button('Refresh licensed and installed maps').props.onPress());
  await act(async () => button('Select: NORTH AMERICA Nevada').props.onPress());
  await act(async () => button('Download selected licensed maps').props.onPress());
  expect(alert).toHaveBeenCalledWith('CoPilot map request failed', 'No active route allowed');
  expect(button('Download selected licensed maps').props.disabled).toBe(false);
  alert.mockRestore();
});
