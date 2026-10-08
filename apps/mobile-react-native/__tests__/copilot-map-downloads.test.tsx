import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  AppState,
  NativeModules,
  Platform,
  Text,
  TextInput,
} from 'react-native';
import { CoPilotMapDownloads } from '../src/components/CoPilotMapDownloads';
import {
  mapCommand,
  mapProgress,
  readMapCatalog,
  regionLabel,
  type MapCatalog,
} from '../src/services/copilot/MapDownloads';

jest.mock('../src/components/DriverUI', () => ({
  useDriverPalette: () => ({ text: '#fff', muted: '#aaa', input: '#222' }),
}));
const region = {
  id: 40,
  name: 'NORTH_AMERICA_California',
  label: 'California',
  status: 'NOT_REQUESTED',
  downloadedBytes: 0,
  totalBytes: 0,
};
const initial: MapCatalog = {
  freeBytes: 10 * 1073741824,
  regions: [
    region,
    { ...region, id: 41, name: 'NORTH_AMERICA_Nevada', label: 'Nevada' },
  ],
  installed: [],
};
let catalog: MapCatalog;
let read: jest.Mock;
let command: jest.Mock;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
    writable: true,
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  catalog = JSON.parse(JSON.stringify(initial));
  read = jest.fn().mockImplementation(async () => catalog);
  command = jest.fn().mockResolvedValue('SUCCESS');
  NativeModules.SemiTraxCoPilotSetup = {
    setMapPanelVisible: jest.fn(),
    readMapCatalog: read,
    mapCommand: command,
  };
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function render() {
  await act(async () => {
    tree = create(<CoPilotMapDownloads />);
  });
}
function text() {
  return tree?.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
}
function button(label: string) {
  return tree!.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === label,
  )[0]!;
}
async function select() {
  await act(async () => {
    tree!.root
      .findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          node.props.accessibilityRole === 'radio',
      )[0]!
      .props.onPress();
  });
}

test('uses SDK region names and never hardcodes a numeric map identity', async () => {
  const result = await readMapCatalog();
  expect(regionLabel(result.regions[0]!)).toBe('California');
  expect(regionLabel({ ...region, label: '' })).toBe('California');
});
test('rejects malformed and duplicated licensed catalogs', async () => {
  catalog.regions.push(region);
  await expect(readMapCatalog()).rejects.toThrow('COPILOT_MAP_CATALOG_INVALID');
  read.mockResolvedValue({ ...initial, freeBytes: -1 });
  await expect(readMapCatalog()).rejects.toThrow('COPILOT_MAP_CATALOG_INVALID');
});
test('invalid identifiers cannot invoke native mutations', async () => {
  await expect(mapCommand(1.5, 'download')).rejects.toThrow(
    'COPILOT_MAP_REGION_INVALID',
  );
  expect(command).not.toHaveBeenCalled();
});
test('vendor error details are never displayed', async () => {
  command.mockRejectedValue({
    code: 'private-code',
    message: 'secret device payload',
  });
  await expect(mapCommand(40, 'download')).rejects.toThrow(
    'COPILOT_MAP_OPERATION_FAILED',
  );
});
test('map download success and installation callbacks do not substitute for installed inventory', () => {
  expect(mapProgress({ ...region, status: 'SUCCEEDED' }, [])).toContain(
    'waiting for installation',
  );
  expect(
    mapProgress({ ...region, status: 'INSTALLATION_FINISHED' }, []),
  ).toContain('verifying inventory');
  expect(
    mapProgress(region, [
      {
        id: 41,
        name: 'Nevada',
        label: 'Nevada',
        year: 2026,
        quarter: 2,
        version: 'verified',
      },
    ]),
  ).toBe('Not installed');
  expect(
    mapProgress(region, [
      {
        id: 40,
        name: 'California',
        label: 'California',
        year: 2026,
        quarter: 2,
        version: 'verified',
      },
    ]),
  ).toBe('Installed · 2026 Q2 · verified');
});
test('shows only licensed regions and requires a user selection before download', async () => {
  await render();
  expect(text()).toContain('California');
  expect(text()).toContain('Nevada');
  expect(button('Download selected map')).toBeUndefined();
  await select();
  await act(async () => {
    button('Download selected map').props.onPress();
  });
  expect(command).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledWith(40, 'download');
  expect(text()).toContain('Installation will be checked separately');
});
test('search finds the licensed region by readable name', async () => {
  await render();
  await act(async () =>
    tree!.root.findByType(TextInput).props.onChangeText('Nevada'),
  );
  const options = tree!.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityRole === 'radio',
  );
  expect(options.length).toBeGreaterThan(0);
  expect(text()).not.toContain('California');
  await act(async () => options[0]!.props.onPress());
  await act(async () => button('Download selected map').props.onPress());
  expect(command).toHaveBeenCalledWith(41, 'download');
});
test('progress uses downloaded bytes and inventory is refreshed automatically', async () => {
  await render();
  catalog.regions[0] = {
    ...region,
    status: 'DOWNLOADING',
    downloadedBytes: 25,
    totalBytes: 100,
  };
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(text()).toContain('Downloading · 25%');
  catalog.installed = [
    {
      id: 40,
      name: region.name,
      label: 'California',
      year: 2026,
      quarter: 2,
      version: 'map-release',
    },
  ];
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(text()).toContain('Installed · 2026 Q2 · map-release');
});
test('paused map exposes resume without allowing duplicate download', async () => {
  catalog.regions[0]!.status = 'PAUSED';
  await render();
  await select();
  expect(button('Download selected map').props.disabled).toBe(true);
  await act(async () => button('Resume').props.onPress());
  expect(command).toHaveBeenCalledWith(40, 'resume');
});
test('duplicate taps cannot issue two download mutations', async () => {
  let resolve!: (value: string) => void;
  command.mockReturnValue(
    new Promise<string>(done => {
      resolve = done;
    }),
  );
  await render();
  await select();
  await act(async () => {
    button('Download selected map').props.onPress();
    button('Download selected map').props.onPress();
  });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => resolve('SUCCESS'));
});
test('no polling occurs while app is in background or after panel closes', async () => {
  await render();
  expect(
    NativeModules.SemiTraxCoPilotSetup.setMapPanelVisible,
  ).toHaveBeenCalledWith(true);
  const calls = read.mock.calls.length;
  AppState.currentState = 'background';
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(read).toHaveBeenCalledTimes(calls);
  await act(async () => tree!.unmount());
  tree = undefined;
  expect(
    NativeModules.SemiTraxCoPilotSetup.setMapPanelVisible,
  ).toHaveBeenLastCalledWith(false);
  AppState.currentState = 'active';
  await jest.advanceTimersByTimeAsync(6000);
  expect(read).toHaveBeenCalledTimes(calls);
});
