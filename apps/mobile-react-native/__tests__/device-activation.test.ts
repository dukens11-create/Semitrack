import { Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  activationUrl,
  openDeviceActivation,
} from '../src/services/copilot/DeviceActivation';
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
}));

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
});
test('encodes identifiers without allowing activation parameter injection', () => {
  const uri = new URL(
    activationUrl({ companyId: ' company ', assetId: 'device&ProductKey=bad' }),
  );
  expect(uri.searchParams.get('CompanyID')).toBe('company');
  expect(uri.searchParams.get('AssetID')).toBe('device&ProductKey=bad');
  expect(uri.searchParams.has('ProductKey')).toBe(false);
  expect(uri.searchParams.get('showconfirmation')).toBe('true');
});
test('rejects blank or control-character IDs', () => {
  for (const assetId of ['', ' ', 'device\nother']) {
    expect(() => activationUrl({ companyId: 'company', assetId })).toThrow();
  }
});
test('does not launch when secure persistence fails', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(false);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await expect(
    openDeviceActivation({ companyId: 'company', assetId: 'device' }),
  ).rejects.toThrow('DEVICE_SETTINGS_SAVE_FAILED');
  expect(open).not.toHaveBeenCalled();
});
test('propagates launch failure without reporting activation success', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue({});
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('not installed'));
  await expect(
    openDeviceActivation({ companyId: 'company', assetId: 'device' }),
  ).rejects.toThrow('COPILOT_LAUNCH_FAILED');
});
test('identifies an unavailable CoPilot app without saving or launching', async () => {
  (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
  (Keychain.setGenericPassword as jest.Mock).mockClear();
  const open = jest.spyOn(Linking, 'openURL');
  await expect(
    openDeviceActivation({ companyId: 'company', assetId: 'device' }),
  ).rejects.toThrow('COPILOT_APP_UNAVAILABLE');
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
test('classifies secure storage rejection independently of app launch', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(
    new Error('storage'),
  );
  const open = jest.spyOn(Linking, 'openURL');
  await expect(
    openDeviceActivation({ companyId: 'company', assetId: 'device' }),
  ).rejects.toThrow('DEVICE_SETTINGS_SAVE_FAILED');
  expect(open).not.toHaveBeenCalled();
});
