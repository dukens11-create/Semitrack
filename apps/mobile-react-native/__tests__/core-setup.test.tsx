import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';
import {
  DriverSetup,
  DriverSetupGate,
} from '../src/features/onboarding/DriverSetup';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import type { ApiClient } from '../src/services/api/ApiClient';
import { RecoveryLinkEntry } from '../src/features/auth/RecoveryLinkEntry';
import type { AuthStore } from '../src/features/auth/AuthStore';
import { deferred } from './fixtures';
import NativePlatform from '../src/native/navigation/NativeSemiTraxPlatform';
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: {
    locationPermissionStatus: jest.fn(async () => 'denied'),
    requestLocationPermission: jest.fn(async () => 'granted'),
  },
}));
const initial: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'imperial',
  dayNightMode: 'day',
  trafficReroute: true,
  settingsJson: { unrelated: 'keep' },
};
let screen: ReactTestRenderer;
const text = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const button = (label: string) =>
  screen.root.findAll(
    n =>
      n.props?.accessibilityLabel === label &&
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
async function setup(data = initial, mode: 'day' | 'night' = 'day') {
  const request = jest.fn(async (method, _path, body) =>
    method === 'PUT' ? body : data,
  );
  const settings = new SettingsService({ request } as unknown as ApiClient);
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <DriverSetupGate settings={settings}>
          <Text>Application</Text>
        </DriverSetupGate>
      </DriverAppearanceContext.Provider>,
    );
  });
  return { settings, request };
}
test.each(['day', 'night'] as const)(
  '%s first run explains privacy, truck restrictions and licensing without prompting',
  async mode => {
    await setup(initial, mode);
    expect(text()).toContain('Location and privacy');
    expect(text()).toContain('not consent to an unpublished policy');
    expect(text()).toContain('actual');
    expect(text()).toContain('license and maps');
    expect(NativePlatform!.requestLocationPermission).not.toHaveBeenCalled();
    await press('Allow location while using the app');
    expect(NativePlatform!.requestLocationPermission).toHaveBeenCalledWith(
      false,
    );
    expect(text()).toContain('fresh, precise fix is still required');
  },
);
test('finish preserves unrelated settings, requires server acknowledgement and survives remount', async () => {
  const { settings, request } = await setup();
  const pending = deferred<Settings>();
  request.mockImplementationOnce(() => pending.promise);
  await press('Finish setup');
  expect(text()).not.toContain('Application');
  expect(request.mock.calls[1]![2]).toMatchObject({
    settingsJson: {
      unrelated: 'keep',
      driverSetup: { reviewed: true, version: 1 },
    },
  });
  await act(async () => pending.resolve(request.mock.calls[1]![2]));
  expect(text()).toContain('Application');
  await act(async () => screen.unmount());
  await act(async () => {
    screen = create(
      <DriverSetupGate settings={settings}>
        <Text>Restored application</Text>
      </DriverSetupGate>,
    );
  });
  expect(text()).toContain('Restored application');
  expect(screen.root.findAllByType(DriverSetup)).toHaveLength(0);
});
test('continue for now does not persist consent or reviewed state', async () => {
  const { request, settings } = await setup();
  await press('Continue for now');
  expect(text()).toContain('Application');
  expect(request).toHaveBeenCalledTimes(1);
  expect(settings.getSnapshot().settings?.settingsJson).toEqual({
    unrelated: 'keep',
  });
});
test('failed preferences load permits explicit continuation without fake defaults', async () => {
  const request = jest
    .fn()
    .mockRejectedValue(new Error('offline with sensitive server details'));
  const settings = new SettingsService({ request } as unknown as ApiClient);
  await act(async () => {
    screen = create(
      <DriverSetupGate settings={settings}>
        <Text>Application</Text>
      </DriverSetupGate>,
    );
  });
  expect(button('Finish setup').props.disabled).toBe(true);
  expect(text()).not.toContain('sensitive');
  await press('Continue for now');
  expect(text()).toContain('Application');
});
test('failed save retains setup and does not erase preferences', async () => {
  const { request, settings } = await setup();
  request.mockRejectedValueOnce(new Error('secret response'));
  await press('Finish setup');
  expect(text()).toContain('Could not save setup');
  expect(text()).not.toContain('secret response');
  expect(settings.getSnapshot().settings).toEqual(initial);
});
test('permission denial is not treated as granted and is optional', async () => {
  await setup();
  (
    NativePlatform!.requestLocationPermission as jest.Mock
  ).mockResolvedValueOnce('denied');
  await press('Allow location while using the app');
  expect(text()).toContain('Location permission denied');
  expect(button('Finish setup').props.disabled).toBe(false);
});

test('cold and warm reset links prefill masked credential and never submit automatically', async () => {
  const token = 'a'.repeat(64),
    newer = 'b'.repeat(64);
  const confirmPasswordReset = jest.fn();
  const closeManualPanel = jest.fn();
  jest
    .spyOn(Linking, 'getInitialURL')
    .mockResolvedValue(
      'https://www.semitrax.com/reset-password.html#token=' + token,
    );
  const listeners = jest.spyOn(Linking, 'addEventListener');
  await act(async () => {
    screen = create(
      <RecoveryLinkEntry
        auth={{ confirmPasswordReset } as unknown as AuthStore}
        onOpen={closeManualPanel}
      />,
    );
  });
  const field = () =>
    screen.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Recovery link')!;
  expect(field().props.value).toBe(token);
  expect(field().props.secureTextEntry).toBe(true);
  expect(closeManualPanel).toHaveBeenCalledTimes(1);
  expect(confirmPasswordReset).not.toHaveBeenCalled();
  await act(async () =>
    listeners.mock.calls.at(-1)![1]({
      url: 'https://www.semitrax.com/reset-password#token=' + newer,
    }),
  );
  expect(field().props.value).toBe(newer);
  expect(closeManualPanel).toHaveBeenCalledTimes(2);
  expect(confirmPasswordReset).not.toHaveBeenCalled();
});
test('untrusted incoming URLs and native lookup errors cannot open reset or leak details', async () => {
  jest
    .spyOn(Linking, 'getInitialURL')
    .mockRejectedValue(new Error('SECRET_TOKEN_IN_URL'));
  const listeners = jest.spyOn(Linking, 'addEventListener');
  await act(async () => {
    screen = create(<RecoveryLinkEntry auth={{} as AuthStore} />);
  });
  await act(async () =>
    listeners.mock.calls.at(-1)![1]({
      url: 'https://evil.test/reset-password#token=' + 'a'.repeat(64),
    }),
  );
  expect(screen.toJSON()).toBeNull();
});
