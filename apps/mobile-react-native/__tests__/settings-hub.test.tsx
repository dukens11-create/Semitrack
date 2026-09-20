import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
} from 'react-native';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import { Store } from '../src/state/Store';
import { UnavailableNavigationEngine } from '../src/services/guidance/NavigationEngine';
import type { Services } from '../src/app/services';
import type { ApiClient } from '../src/services/api/ApiClient';
import { deferred, user } from './fixtures';
import { DiagnosticsScreen } from '../src/screens/DiagnosticsScreen';
import { Alert } from '../src/components/ThemedAlert';
import {
  beginRouteDiagnostic,
  clearRouteDiagnostics,
  routeDiagnosticHistory,
} from '../src/features/routing/routeTelemetry';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));
const initial: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'imperial',
  dayNightMode: 'system',
  trafficReroute: true,
  settingsJson: { keep: 'untouched' },
};
class Account extends Store<{ status: string; user: typeof user }> {
  constructor() {
    super({ status: 'signedIn', user: { ...user, phone: null } });
  }
  updateProfile = jest.fn(async (fullName: string, phone: string | null) => {
    this.publish({
      ...this.value,
      user: { ...this.value.user, fullName, phone } as typeof user,
    });
  });
  logout = jest.fn(async () => {});
  changePassword = jest.fn(async () => {});
}
let screen: ReactTestRenderer;
const content = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const button = (label: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
const field = (label: string) =>
  screen.root
    .findAllByType(TextInput)
    .find(n => n.props.accessibilityLabel === label)!;
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
async function fill(label: string, value: string) {
  await act(async () => field(label).props.onChangeText(value));
}
async function setup(mode: 'day' | 'night' | 'system' = 'day') {
  const request = jest.fn(async (method, _path, body) =>
    method === 'PUT' ? body : initial,
  );
  const settings = new SettingsService({ request } as unknown as ApiClient),
    auth = new Account(),
    guidance = new UnavailableNavigationEngine();
  const initialize = jest.spyOn(guidance, 'initialize'),
    onBack = jest.fn(), onPlans = jest.fn();
  const services = { settings, auth, guidance } as unknown as Services;
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider
        value={mode === 'system' ? 'night' : mode}
      >
        <SettingsScreen services={services} onBack={onBack} onPlans={onPlans} />
      </DriverAppearanceContext.Provider>,
    );
  });
  return { settings, request, auth, initialize, onBack, onPlans };
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});

test('hub has one title, actual account details, no exposed forms or invented support link', async () => {
  const { onBack } = await setup();
  expect(content().match(/Account & Settings/g)).toHaveLength(1);
  expect(content()).toContain(user.fullName);
  expect(content()).toContain(user.email);
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
  expect(button('Help & support')).toBeUndefined();
  expect(content()).not.toContain('not configured in this build');
  await press('Back to More');
  expect(onBack).toHaveBeenCalledTimes(1);
});
test('profile save is dirty/valid only, uses actual API rules and updates hub after success', async () => {
  const { auth } = await setup();
  await press('Account & profile');
  expect(button('Save changes').props.disabled).toBe(true);
  expect(field('Email').props.editable).toBe(false);
  expect(field('Phone').props.maxLength).toBe(30);
  expect(field('Phone').props.keyboardType).toBe('phone-pad');
  await fill('Full name', 'X');
  expect(button('Save changes').props.disabled).toBe(true);
  await fill('Full name', 'Updated Driver');
  await fill('Phone', '5550100');
  expect(button('Save changes').props.disabled).toBe(false);
  await press('Save changes');
  expect(auth.updateProfile).toHaveBeenCalledWith('Updated Driver', '5550100');
  expect(content()).toContain('Profile saved.');
  expect(button('Save changes').props.disabled).toBe(true);
  await press('Back');
  expect(content()).toContain('Updated Driver');
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
});
test('profile failure recovers enabled state and double submission is locked', async () => {
  const { auth } = await setup();
  await press('Account & profile');
  await fill('Full name', 'Retry Driver');
  const waiting = deferred<void>();
  auth.updateProfile.mockImplementationOnce(() => waiting.promise);
  const save = button('Save changes');
  await act(async () => {
    save.props.onPress();
    save.props.onPress();
  });
  expect(auth.updateProfile).toHaveBeenCalledTimes(1);
  expect(button('Save changes').props.accessibilityState.busy).toBe(true);
  await act(async () => waiting.reject(new Error('offline')));
  expect(button('Save changes').props.disabled).toBe(false);
  expect(field('Full name').props.value).toBe('Retry Driver');
  await press('Save changes');
  expect(content()).toContain('Profile saved.');
});
test('password validation includes mismatch and byte limit without exposing technical copy', async () => {
  const { auth } = await setup();
  await press('Password & security');
  expect(button('Change password').props.disabled).toBe(true);
  await fill('Current password', 'current-secret');
  await fill('New password', 'tencharacters');
  await fill('Confirm new password', 'different');
  expect(content()).toContain('Passwords do not match');
  expect(button('Change password').props.disabled).toBe(true);
  await fill('New password', '🔐'.repeat(20));
  await fill('Confirm new password', '🔐'.repeat(20));
  expect(content()).toContain('Choose a shorter password');
  expect(content()).not.toContain('UTF-8');
  expect(button('Change password').props.disabled).toBe(true);
  await fill('New password', 'valid-secret-123');
  await fill('Confirm new password', 'valid-secret-123');
  expect(field('New password').props.secureTextEntry).toBe(true);
  await press('Show new password');
  expect(field('New password').props.secureTextEntry).toBe(false);
  await press('Hide new password');
  expect(field('New password').props.secureTextEntry).toBe(true);
  await press('Change password');
  expect(auth.changePassword).toHaveBeenCalledWith(
    'current-secret',
    'valid-secret-123',
  );
  expect(field('New password').props.value).toBe('');
  expect(content()).toContain(
    "You'll be signed out after changing your password.",
  );
});
test('leaving password screen clears secrets', async () => {
  await setup();
  await press('Password & security');
  await fill('Current password', 'private');
  await press('Back');
  await press('Password & security');
  expect(field('Current password').props.value).toBe('');
});
test.each(['Automatic', 'Day', 'Night'])(
  '%s saves immediately through existing settings service',
  async label => {
    const { settings, request } = await setup();
    await press('Map & display');
    if (label === 'Automatic') await press('Night');
    await press(label);
    expect(settings.getSnapshot().settings?.dayNightMode).toBe(
      label === 'Automatic' ? 'system' : label.toLowerCase(),
    );
    expect(
      request.mock.calls.filter(c => c[0] === 'PUT').length,
    ).toBeGreaterThan(0);
    expect(button('Save preferences')).toBeUndefined();
  },
);
test('map toggles and units persist without discarding unrelated preferences', async () => {
  const { settings } = await setup();
  await press('Map & display');
  await act(async () =>
    screen.root
      .findAllByType(Switch)
      .find(n => n.props.accessibilityLabel === 'Satellite map')!
      .props.onValueChange(true),
  );
  await press('Back');
  await press('Units');
  await press('°C');
  await press('Kilometers');
  expect(settings.getSnapshot().settings).toMatchObject({
    units: 'metric',
    settingsJson: {
      keep: 'untouched',
      rnTemperatureUnit: 'C',
      rnMap: { satellite: true },
    },
  });
  expect(content()).toContain('Truck measurements keep their original units.');
});
test('failed autosave restores accepted choice, does not claim success, and allows retry', async () => {
  const { settings, request } = await setup();
  await press('Units');
  request.mockRejectedValueOnce(new Error('offline'));
  await press('Kilometers');
  expect(button('Miles').props.accessibilityState.checked).toBe(true);
  expect(settings.getSnapshot().settings?.units).toBe('imperial');
  expect(content()).not.toContain('Preference saved.');
  await press('Kilometers');
  expect(button('Kilometers').props.accessibilityState.checked).toBe(true);
  expect(content()).toContain('Preference saved.');
});
test('unprovisioned navigation keeps stored ON preferences but never activates the provider', async () => {
  const { initialize, settings } = await setup();
  await press('Navigation');
  expect(content()).toContain('CoPilot setup required');
  expect(content()).toContain(
    'On when navigation becomes available · saved preference',
  );
  expect(initialize).not.toHaveBeenCalled();
  const voice = screen.root
    .findAllByType(Switch)
    .find(n => n.props.accessibilityLabel === 'Voice guidance')!;
  expect(voice.props.value).toBe(true);
  await act(async () => voice.props.onValueChange(false));
  expect(settings.getSnapshot().settings?.voiceEnabled).toBe(false);
  await fill('Voice language', 'fr-CA');
  await press('Save voice language');
  expect(settings.getSnapshot().settings?.voiceLocale).toBe('fr-CA');
  expect(initialize).not.toHaveBeenCalled();
});
test('privacy and About preserve available information; opening does not request permissions', async () => {
  const { request } = await setup();
  await press('Privacy & location');
  expect(content()).toContain('device settings');
  await press('Back');
  await press('About SemiTraX');
  expect(content()).toContain(require('../package.json').version);
  expect(request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
});
test('sign out retains existing direct logout semantics and neutral destructive treatment', async () => {
  const { auth } = await setup();
  const style = StyleSheet.flatten(button('Sign out').props.style);
  expect(style.backgroundColor).not.toBe('#FF6B2C');
  await press('Sign out');
  expect(auth.logout).toHaveBeenCalledTimes(1);
});
test('Android back dismisses keyboard first, then returns to hub without adding navigation entries', async () => {
  const listeners = jest.spyOn(BackHandler, 'addEventListener');
  const visible = jest.spyOn(Keyboard, 'isVisible');
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await setup();
  await press('Account & profile');
  await fill('Full name', 'Retained draft');
  const back = () =>
    listeners.mock.calls
      .filter(c => c[0] === 'hardwareBackPress')
      .at(-1)![1]();
  visible.mockReturnValue(true);
  await act(async () => {
    expect(back()).toBe(true);
  });
  expect(dismiss).toHaveBeenCalled();
  expect(field('Full name')).toBeDefined();
  visible.mockReturnValue(false);
  await act(async () => {
    expect(back()).toBe(true);
  });
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => {
    expect(back()).toBe(false);
  });
  await press('Account & profile');
  expect(field('Full name').props.value).toBe('Retained draft');
});
test.each(['day', 'night', 'system'] as const)(
  '%s sections keep readable theme and keyboard-safe scroll containers',
  async mode => {
    (useColorScheme as jest.Mock).mockReturnValue('dark');
    await setup(mode);
    for (const page of [
      'Account & profile',
      'Password & security',
      'Map & display',
      'Units',
      'Navigation',
      'Privacy & location',
      'Diagnostics',
      'Driver setup',
      'About SemiTraX',
    ]) {
      await press(page);
      const scroll = screen.root.findAllByType(ScrollView).at(-1)!;
      expect(StyleSheet.flatten(scroll.props.style).backgroundColor).toBe(
        mode === 'day' ? '#F3F5F7' : '#0C131B',
      );
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
      expect(
        screen.root.findAllByType(KeyboardAvoidingView).length,
      ).toBeGreaterThan(0);
      await press('Back');
    }
  },
);

test('visible Diagnostics opens from Settings, clears only diagnostics, and Android Back returns to Settings', async () => {
  const listeners = jest.spyOn(BackHandler, 'addEventListener');
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  const confirm = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { settings, auth, request, initialize } = await setup();
  const accountBefore = JSON.stringify(auth.getSnapshot());
  const settingsBefore = JSON.stringify(settings.getSnapshot());
  const requestCount = request.mock.calls.length;
  beginRouteDiagnostic({}, 2);
  expect(button('Diagnostics')).toBeDefined();
  await press('Diagnostics');
  expect(screen.root.findAllByType(DiagnosticsScreen)).toHaveLength(1);
  await press('Clear Diagnostics');
  await act(async () =>
    confirm.mock.calls[0]![2]!.find(b => b.style === 'destructive')!.onPress!(),
  );
  expect(routeDiagnosticHistory()).toEqual([]);
  expect(JSON.stringify(auth.getSnapshot())).toBe(accountBefore);
  expect(JSON.stringify(settings.getSnapshot())).toBe(settingsBefore);
  expect(request).toHaveBeenCalledTimes(requestCount);
  expect(auth.logout).not.toHaveBeenCalled();
  expect(initialize).not.toHaveBeenCalled();
  await act(async () => {
    const back = listeners.mock.calls
      .filter(c => c[0] === 'hardwareBackPress')
      .at(-1)![1];
    expect(back()).toBe(true);
  });
  expect(screen.root.findAllByType(DiagnosticsScreen)).toHaveLength(0);
  expect(button('Diagnostics')).toBeDefined();
  clearRouteDiagnostics();
});
test('profile buttons distinguish invalid/unchanged, enabled and loading rather than forced opacity', async () => {
  await setup();
  await press('Account & profile');
  const inactive = StyleSheet.flatten(
    button('Save changes').props.style({ pressed: false }),
  );
  expect(inactive.backgroundColor).toBe('#E4E8ED');
  expect(content()).toContain('No changes to save.');
  await fill('Full name', 'Valid change');
  const active = StyleSheet.flatten(
    button('Save changes').props.style({ pressed: false }),
  );
  expect(active.backgroundColor).toBe('#FF6B2C');
  expect(active.opacity).toBeUndefined();
});

test('Plans row opens the existing navigation destination', async () => { const {onPlans}=await setup(); await press('Plans & Subscription'); expect(onPlans).toHaveBeenCalledTimes(1); });
