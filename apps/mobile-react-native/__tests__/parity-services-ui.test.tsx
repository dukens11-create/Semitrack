import { Alert } from '../src/components/ThemedAlert';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { Services } from '../src/app/services';
import { EldScreen } from '../src/screens/EldScreen';
import { OfflineMapsScreen } from '../src/screens/OfflineMapsScreen';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn(async () => {}),
    StyleURL: { Street: 'mapbox://styles/mapbox/streets-v12' },
    offlineManager: {
      getPacks: jest.fn(async () => []),
      createPack: jest.fn(),
      deletePack: jest.fn(async () => {}),
      unsubscribe: jest.fn(),
    },
  },
}));
const mockCopilotState = {
  mapsReady: false,
  maps: {
    installed: [] as {
      set: number;
      year: number;
      quarter: number;
      versionString: string;
    }[],
  },
};
const mockSetup = {
  downloadStatus: '',
  retry: jest.fn().mockResolvedValue(undefined),
  configure: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotState: () => mockCopilotState,
  useCopilotSetup: () => mockSetup,
}));
let screen: ReactTestRenderer;
const content = () =>
  screen.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
const button = (label: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
function eldSetup() {
  const connection = {
    provider: 'SAMSARA',
    status: 'CONNECTED',
    lastSyncedAt: '2026-09-15T12:00:00Z',
    lastErrorCode: null,
  };
  const request = jest.fn(async (method: string, path: string) => {
    if (path === '/eld/connections') return { items: [connection] };
    if (path === '/eld/hos/current')
      return {
        status: 'UNKNOWN',
        reason: 'DRIVER_MAPPING_REQUIRED',
        certifiedEld: false,
      };
    if (path.endsWith('/connect'))
      return {
        authorizeUrl:
          'https://api.samsara.com/oauth2/authorize?response_type=code&client_id=fixture&state=fixture',
      };
    return null;
  });
  return { request, services: { api: { request } } as unknown as Services };
}
test('ELD screen shows real connection timestamp and honest unmapped HOS; sync uses selected authenticated API path', async () => {
  const { request, services } = eldSetup();
  await act(async () => {
    screen = create(<EldScreen services={services} />);
  });
  expect(content()).toContain('CONNECTED');
  expect(content()).toContain('2026-09-15T12:00:00Z');
  expect(content()).toContain('DRIVER_MAPPING_REQUIRED');
  expect(content()).toContain('not a certified ELD');
  await press('Sync SAMSARA');
  expect(request).toHaveBeenCalledWith('POST', '/eld/SAMSARA/sync', {});
  expect(button('Sync MOTIVE').props.disabled).toBe(true);
});
test('ELD connection opens only returned approved provider OAuth URL; disconnect needs explicit confirmation', async () => {
  const { request, services } = eldSetup();
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => {
    screen = create(<EldScreen services={services} />);
  });
  await press('Connect SAMSARA');
  expect(open).toHaveBeenCalledWith(
    expect.stringContaining('https://api.samsara.com/oauth2/authorize?'),
  );
  await press('Disconnect SAMSARA');
  expect(request.mock.calls.some(c => c[0] === 'DELETE')).toBe(false);
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Disconnect')!.onPress!(),
  );
  expect(request).toHaveBeenCalledWith('DELETE', '/eld/SAMSARA');
});
test('ELD unconfigured provider errors remain visible and do not claim successful connection', async () => {
  const { request, services } = eldSetup();
  await act(async () => {
    screen = create(<EldScreen services={services} />);
  });
  request.mockRejectedValueOnce({
    code: 'ELD_PROVIDER_NOT_CONFIGURED',
    status: 503,
  } as never);
  await press('Connect MOTIVE');
  expect(content()).toContain('not configured');
  expect(content()).not.toContain('Remaining drive:');
});
test('offline maps use CoPilot inventory and preserve existing Mapbox packs', async () => {
  mockCopilotState.mapsReady = true;
  mockCopilotState.maps.installed = [
    {
      set: 42,
      year: 2026,
      quarter: 3,
      versionString: 'California map fixture',
    },
  ];
  const services = {
    api: { request: jest.fn().mockResolvedValue({}) },
  } as unknown as Services;
  await act(async () => {
    screen = create(<OfflineMapsScreen services={services} />);
  });
  expect(content()).toContain('California offline map verified');
  expect(content()).toContain('California map fixture');
  expect(Mapbox.offlineManager.getPacks).not.toHaveBeenCalled();
  expect(Mapbox.offlineManager.createPack).not.toHaveBeenCalled();
  expect(Mapbox.offlineManager.deletePack).not.toHaveBeenCalled();
  await press('Check API connectivity');
  expect(services.api.request).toHaveBeenCalledWith('GET', '/health');
  expect(content()).toContain('checked independently');
});
test('offline setup retains assigned Device ID capitalization and does not claim maps installed', async () => {
  mockCopilotState.mapsReady = false;
  mockCopilotState.maps.installed = [];
  const services = { api: { request: jest.fn() } } as unknown as Services;
  await act(async () => {
    screen = create(<OfflineMapsScreen services={services} />);
  });
  expect(content()).toContain('installation has not been verified');
  await act(async () => {
    screen.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'CoPilot Company ID')!
      .props.onChangeText('Company-Fixture');
    screen.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'CoPilot Device ID')!
      .props.onChangeText('Phone-FIXTURE-01');
  });
  await press('Save CoPilot device setup');
  expect(mockSetup.configure).toHaveBeenCalledWith(
    'Company-Fixture',
    'Phone-FIXTURE-01',
  );
  expect(content()).toContain('installation has not been verified');
  expect(Mapbox.offlineManager.createPack).not.toHaveBeenCalled();
  await press('Retry saved CoPilot setup');
  expect(mockSetup.retry).toHaveBeenCalledTimes(1);
});
