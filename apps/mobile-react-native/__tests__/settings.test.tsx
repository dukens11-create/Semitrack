import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { DriverPreferences } from '../src/features/settings/DriverPreferences';
import { useDriverPalette } from '../src/components/DriverUI';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { Services } from '../src/app/services';
import { Store } from '../src/state/Store';
import { UnavailableNavigationEngine } from '../src/services/guidance/NavigationEngine';
import { deferred, user } from './fixtures';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
const initial: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'imperial',
  dayNightMode: 'system',
  trafficReroute: false,
  settingsJson: { unrelated: 'preserve' },
};
function setup() {
  const request = jest.fn().mockResolvedValue(initial);
  const settings = new SettingsService({ request } as unknown as ApiClient);
  return { request, settings };
}
test('concurrent loads share a request, cached read does not reset saved settings', async () => {
  const { request, settings } = setup();
  const pending = deferred<Settings>();
  request.mockReturnValueOnce(pending.promise);
  const a = settings.load(),
    b = settings.load();
  expect(a).toBe(b);
  pending.resolve(initial);
  await a;
  request.mockResolvedValueOnce({ ...initial, units: 'metric' });
  await settings.save({ ...initial, units: 'metric' });
  await settings.load();
  expect(request).toHaveBeenCalledTimes(2);
  expect(settings.getSnapshot().settings?.units).toBe('metric');
});
test('failed save keeps last accepted values and reports failure', async () => {
  const { request, settings } = setup();
  await settings.load();
  request.mockRejectedValueOnce(new Error('offline'));
  await expect(
    settings.save({ ...initial, dayNightMode: 'night' }),
  ).rejects.toThrow('offline');
  expect(settings.getSnapshot().settings).toEqual(initial);
  expect(settings.getSnapshot().error).toContain('not saved');
});
test('late GET cannot overwrite a newer accepted save', async () => {
  const { request, settings } = setup();
  const pending = deferred<Settings>();
  request.mockReturnValueOnce(pending.promise);
  const loading = settings.load();
  request.mockResolvedValueOnce({ ...initial, units: 'metric' });
  await settings.save({ ...initial, units: 'metric' });
  pending.resolve(initial);
  await loading;
  expect(settings.getSnapshot().settings?.units).toBe('metric');
});
test('logout invalidates pending load and pending save without republishing previous account preferences', async () => {
  const { request, settings } = setup();
  const pending = deferred<Settings>();
  request.mockReturnValueOnce(pending.promise);
  const load = settings.load();
  settings.clear();
  pending.resolve(initial);
  expect(await load).toBeNull();
  expect(settings.getSnapshot().settings).toBeNull();
  const savePending = deferred<Settings>();
  request.mockReturnValueOnce(savePending.promise);
  const save = settings.save(initial);
  settings.clear();
  savePending.resolve(initial);
  expect(await save).toBeNull();
  expect(settings.getSnapshot().phase).toBe('idle');
});
test('invalid values never reach API and overlapping saves are rejected', async () => {
  const { request, settings } = setup();
  await expect(
    settings.save({ ...initial, voiceLocale: '' }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  const pending = deferred<Settings>();
  request.mockReturnValueOnce(pending.promise);
  const save = settings.save(initial);
  await expect(settings.save({ ...initial, units: 'metric' })).rejects.toThrow(
    'already',
  );
  pending.resolve(initial);
  await save;
  expect(request).toHaveBeenCalledTimes(1);
});
let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
});
function action(label: string) {
  return screen!.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
}
function servicesFor(settings: SettingsService) {
  return {
    settings,
    guidance: new UnavailableNavigationEngine(),
    location: Object.assign(new Store({ fix: null, tracking: false }), {
      startIfPermitted: jest.fn().mockResolvedValue(undefined),
    }),
    auth: Object.assign(new Store({ status: 'signedIn', user }), {
      updateProfile: jest.fn(),
      logout: jest.fn(),
    }),
  } as unknown as Services;
}
test('immediate preference failure keeps accepted values and never announces success', async () => {
  const { request, settings } = setup();
  await act(async () => {
    screen = create(<SettingsScreen services={servicesFor(settings)} />);
  });
  await act(async () => action('Map & display').props.onPress());
  request.mockRejectedValueOnce(new Error('offline'));
  await act(async () => action('Night').props.onPress());
  expect(action('Automatic').props.accessibilityState.checked).toBe(true);
  expect(settings.getSnapshot().settings?.dayNightMode).toBe('system');
  expect(
    screen!.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .flat()
      .join(' '),
  ).not.toContain('Preference saved.');
  expect(action('Save preferences')).toBeUndefined();
  expect(screen!.root.findAllByType(TextInput)).toHaveLength(0);
  request.mockResolvedValueOnce({ ...initial, dayNightMode: 'night' });
  await act(async () => action('Night').props.onPress());
  expect(action('Night').props.accessibilityState.checked).toBe(true);
  expect(
    screen!.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .flat()
      .join(' '),
  ).toContain('Preference saved.');
});

test('server-accepted settings update appearance and retain unrelated settingsJson', async () => {
  const { request, settings } = setup();
  const services = servicesFor(settings);
  function Palette() {
    const p = useDriverPalette();
    return <Text>{p.dark ? 'night' : 'day'}</Text>;
  }
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Palette />
      </DriverPreferences>,
    );
  });
  request.mockResolvedValueOnce({ ...initial, dayNightMode: 'night' });
  await act(async () => {
    await settings.save({ ...initial, dayNightMode: 'night' });
  });
  expect(screen!.root.findByType(Text).props.children).toBe('night');
  expect(request).toHaveBeenLastCalledWith(
    'PUT',
    '/navigation-settings',
    expect.objectContaining({ settingsJson: { unrelated: 'preserve' } }),
  );
});
