import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Share } from 'react-native';
import { CoPilotDeviceSetup } from '../src/components/CoPilotDeviceSetup';

const mockDiagnostics = jest.fn();
const mockRetry = jest.fn();
const mockConfigure = jest.fn();
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => ({ setupDiagnostics: mockDiagnostics }),
}));
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotSetup: () => ({ retry: mockRetry, configure: mockConfigure }),
  useCopilotState: () =>
    jest
      .requireActual('../src/services/copilot/CopilotLifecycle')
      .initialCopilotState(),
}));
jest.mock('../src/components/DriverUI', () => ({
  useDriverPalette: () => ({ text: '#000', muted: '#777' }),
}));

let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
async function share() {
  await act(async () => {
    screen = create(<CoPilotDeviceSetup />);
  });
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === 'Share CoPilot diagnostics' &&
          typeof node.props.onPress === 'function',
      )[0]!
      .props.onPress();
  });
}
test('share reads current native diagnostics and opens the share sheet without changing setup', async () => {
  mockDiagnostics.mockResolvedValue({
    savedCompanyMatches: true,
    savedDeviceMatches: true,
    credentialHook: 'SUPPLY_ASSIGNED',
    hookMatchedAssigned: true,
    callbackMatchedAssigned: true,
    loginResponse: 'FAILED_LOGIN_INVALID_CREDS',
  });
  const sheet = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.dismissedAction });
  await share();
  expect(mockDiagnostics).toHaveBeenCalledTimes(1);
  expect(sheet).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('FAILED_LOGIN_INVALID_CREDS'),
    }),
  );
  expect(mockRetry).not.toHaveBeenCalled();
  expect(mockConfigure).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain(
    'Diagnostic report shared.',
  );
});
test('native diagnostic failure gives a retry message without sharing a partial payload', async () => {
  mockDiagnostics.mockRejectedValue(new Error('private-native-message'));
  const sheet = jest.spyOn(Share, 'share');
  await share();
  expect(sheet).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).toContain(
    'Could not share diagnostics.',
  );
  expect(JSON.stringify(screen.toJSON())).not.toContain(
    'private-native-message',
  );
});
