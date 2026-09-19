import { Alert } from '../src/components/ThemedAlert';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Text } from 'react-native';
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
test('offline screen inventories only owned display packs and deletion is confirmed before native call', async () => {
  const pack = {
    name: 'semitrax-display-fixture',
    status: async () => ({ percentage: 100, completedResourceSize: 1048576 }),
  };
  jest
    .mocked(Mapbox.offlineManager.getPacks)
    .mockResolvedValue([pack, { ...pack, name: 'unrelated-pack' }] as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const services = {
    api: { request: jest.fn() },
    environment: { mapboxToken: '' },
    location: { getFreshFix: () => null },
  } as unknown as Services;
  await act(async () => {
    screen = create(<OfflineMapsScreen services={services} />);
  });
  expect(content()).toContain('1.0');
  expect(content()).not.toContain('unrelated-pack');
  expect(content()).toContain('Offline Mapbox display only');
  await press('Delete semitrax-display-fixture');
  expect(Mapbox.offlineManager.deletePack).not.toHaveBeenCalled();
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Delete')!.onPress!(),
  );
  expect(Mapbox.offlineManager.deletePack).toHaveBeenCalledWith(
    'semitrax-display-fixture',
  );
});
test('offline download uses confirmed fresh GPS area and native progress, never a route engine', async () => {
  jest.mocked(Mapbox.offlineManager.getPacks).mockResolvedValue([]);
  jest
    .mocked(Mapbox.offlineManager.createPack)
    .mockImplementation(async (options, progress) => {
      progress?.(
        {} as never,
        {
          name: options.name,
          percentage: 65,
          completedResourceSize: 2048,
        } as never,
      );
      jest.mocked(Mapbox.offlineManager.getPacks).mockResolvedValue([
        {
          name: options.name,
          status: async () => ({
            percentage: 65,
            completedResourceSize: 2048,
          }),
        },
      ] as never);
    });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const services = {
    api: { request: jest.fn() },
    environment: { mapboxToken: 'pk.fixture' },
    location: {
      getFreshFix: () => ({
        latitude: 40,
        longitude: -100,
        accuracy: 5,
        timestamp: Date.now(),
        heading: 0,
        speed: 0,
      }),
    },
  } as unknown as Services;
  await act(async () => {
    screen = create(<OfflineMapsScreen services={services} />);
  });
  await press('Download current GPS area');
  expect(Mapbox.offlineManager.createPack).not.toHaveBeenCalled();
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Download')!.onPress!(),
  );
  expect(Mapbox.offlineManager.createPack).toHaveBeenCalledWith(
    expect.objectContaining({
      minZoom: 8,
      maxZoom: 14,
      styleURL: Mapbox.StyleURL.Street,
    }),
    expect.any(Function),
    expect.any(Function),
  );
  expect(content()).toContain('65');
  expect(services.api.request).not.toHaveBeenCalled();
});
