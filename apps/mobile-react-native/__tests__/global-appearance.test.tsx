import { DriverSheet } from '../src/components/DriverSheet';
import { DocumentDateField } from '../src/components/DocumentsPresentation';
import { SettingToggle } from '../src/components/SettingsPresentation';
import { DriverField } from '../src/components/DriverUI';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  AppState,
  Dimensions,
  useWindowDimensions,
  Modal,
  TextInput,
  Switch,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type AppStateStatus,
} from 'react-native';
import { ApplicationAppearance } from '../src/features/settings/ApplicationAppearance';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { useDriverPalette } from '../src/components/DriverUI';
import { Alert, ThemedAlertHost } from '../src/components/ThemedAlert';
import { readAppearance } from '../src/features/settings/AppearanceStorage';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import type { ApiClient } from '../src/services/api/ApiClient';
import { deferred } from './fixtures';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/features/settings/AppearanceStorage', () => ({
  readAppearance: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));
const initial: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'imperial',
  dayNightMode: 'day',
  trafficReroute: false,
  settingsJson: null,
};
class Account extends Store<{ status: string }> {
  restore = jest.fn(async () => {});
  set(status: string) {
    this.publish({ status });
  }
}
const setup = (mode: Settings['dayNightMode']) => {
  const auth = new Account({ status: 'signedIn' });
  const request = jest.fn(async () => ({ ...initial, dayNightMode: mode }));
  const settings = new SettingsService({ request } as unknown as ApiClient);
  const location = Object.assign(new Store({ fix: null, tracking: false }), {
    startIfPermitted: jest.fn(async () => {}),
  });
  return {
    auth,
    settings,
    services: { auth, settings, location } as unknown as Services,
  };
};
let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
function Probe({ seen }: { seen: boolean[] }) {
  const p = useDriverPalette();
  const dimensions = useWindowDimensions();
  seen.push(p.dark);
  return (
    <View
      testID="surface"
      style={{ backgroundColor: p.canvas, width: dimensions.width }}
    >
      <Text>{p.dark ? 'DARK' : 'LIGHT'}</Text>
    </View>
  );
}
test.each(['day', 'night'] as const)(
  '%s cold/warm launch, system flips, foreground and rotation preserve explicit appearance',
  async mode => {
    const { services, auth } = setup(mode),
      seen: boolean[] = [];
    const pending = deferred<'day' | 'night'>();
    jest.mocked(readAppearance).mockReturnValueOnce(pending.promise);
    let foreground: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_name, callback) => {
        foreground = callback;
        return { remove: jest.fn() };
      });
    jest
      .mocked(useColorScheme)
      .mockReturnValue(mode === 'day' ? 'dark' : 'light');
    const render = () => (
      <ApplicationAppearance services={services}>
        <Probe seen={seen} />
      </ApplicationAppearance>
    );
    await act(async () => {
      screen = create(render());
    });
    expect(seen).toEqual([]);
    await act(async () => pending.resolve(mode));
    await act(async () => {
      foreground?.('background');
      foreground?.('active');
    });
    // Both directions of system appearance changes must be ignored explicitly.
    for (const scheme of ['light', 'dark', 'light'] as const) {
      await act(async () => {
        jest.mocked(useColorScheme).mockReturnValue(scheme);
        screen.update(render());
      });
    }
    // Exercise a Dimensions event (native rotation itself still needs a device).
    const originalWindow = Dimensions.get('window');
    await act(async () =>
      Dimensions.set({
        window: { ...originalWindow, width: 800, height: 400 },
      }),
    );
    expect(
      screen.root.findByProps({ testID: 'surface' }).props.style.width,
    ).toBe(800);
    await act(async () => Dimensions.set({ window: originalWindow }));
    // Sign-out/recovery and warm sign-in stay beneath the root theme.
    await act(async () => {
      services.settings.clear();
      auth.set('signedOut');
    });
    await act(async () => auth.set('signedIn'));
    expect(new Set(seen)).toEqual(new Set([mode === 'night']));
    await act(async () => screen.unmount());
    jest.mocked(readAppearance).mockResolvedValue(mode);
    await act(async () => {
      screen = create(render());
    });
    expect(new Set(seen)).toEqual(new Set([mode === 'night']));
  },
);
test.each(['light', 'dark'] as const)(
  'Automatic resolves system %s and responds to system changes without solar data',
  async scheme => {
    const { services } = setup('system'),
      seen: boolean[] = [];
    jest.mocked(readAppearance).mockResolvedValue('system');
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const render = () => (
      <ApplicationAppearance services={services}>
        <Probe seen={seen} />
      </ApplicationAppearance>
    );
    await act(async () => {
      screen = create(render());
    });
    expect(seen.at(-1)).toBe(scheme === 'dark');
    await act(async () => {
      jest
        .mocked(useColorScheme)
        .mockReturnValue(scheme === 'dark' ? 'light' : 'dark');
      screen.update(render());
    });
    expect(seen.at(-1)).toBe(scheme !== 'dark');
  },
);
test('unreadable local preference stays neutral and offers retry, never exposes a guessed theme', async () => {
  const { services } = setup('day'),
    seen: boolean[] = [];
  jest
    .mocked(readAppearance)
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce('day');
  await act(async () => {
    screen = create(
      <ApplicationAppearance services={services}>
        <Probe seen={seen} />
      </ApplicationAppearance>,
    );
  });
  expect(seen).toEqual([]);
  const retry = screen.root.findAll(
    n => n.props.accessibilityRole === 'button' && n.props.onPress,
  )[0]!;
  await act(async () => retry.props.onPress());
  expect(new Set(seen)).toEqual(new Set([false]));
});
test.each(['day', 'night'] as const)(
  '%s dialog uses application palette and preserves confirmation/cancel callbacks',
  async mode => {
    const confirm = jest.fn(),
      cancel = jest.fn();
    await act(async () => {
      screen = create(
        <DriverAppearanceContext.Provider value={mode}>
          <ThemedAlertHost />
        </DriverAppearanceContext.Provider>,
      );
    });
    await act(async () =>
      Alert.alert('Confirm', 'Safe confirmation', [
        { text: 'Cancel', style: 'cancel', onPress: cancel },
        { text: 'Continue', onPress: confirm },
      ]),
    );
    const card = screen.root
      .findAllByType(View)
      .find(n => n.props.accessibilityViewIsModal)!;
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(
      mode === 'day' ? '#FFFFFF' : '#17212C',
    );
    await act(async () => screen.root.findByType(Modal).props.onRequestClose());
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () =>
      Alert.alert('Confirm', 'Safe confirmation', [
        { text: 'Continue', onPress: confirm },
      ]),
    );
    await act(async () =>
      screen.root
        .findAll(
          n => n.props.accessibilityLabel === 'Continue' && n.props.onPress,
        )[0]!
        .props.onPress(),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
  },
);
test('appearance persistence is acknowledged before publishing saved settings; failed retention preserves last theme', async () => {
  const pending = deferred<void>(),
    retain = jest.fn().mockReturnValue(pending.promise);
  const request = jest.fn(async (_method, _path, body) => body ?? initial);
  const settings = new SettingsService(
    { request } as unknown as ApiClient,
    retain,
  );
  const load = settings.load();
  expect(settings.getSnapshot().settings).toBeNull();
  pending.resolve();
  await load;
  retain.mockRejectedValueOnce(new Error('local storage unavailable'));
  await expect(
    settings.save({ ...initial, dayNightMode: 'night' }),
  ).rejects.toThrow();
  expect(settings.getSnapshot().settings?.dayNightMode).toBe('day');
});

test('open sheet, date picker, keyboard and toggle follow a saved appearance change without remounting', async () => {
  const { services } = setup('day');
  services.settings = new SettingsService({
    request: jest.fn(async (_method, _path, body) => body ?? initial),
  } as unknown as ApiClient);
  jest.mocked(readAppearance).mockResolvedValue('day');
  jest.mocked(useColorScheme).mockReturnValue('dark');
  await act(async () => {
    screen = create(
      <ApplicationAppearance services={services}>
        <DriverSheet title="Document" onClose={jest.fn()}>
          <DriverField label="Document label" value="License" />
          <DocumentDateField
            label="Expiration date"
            value="2027-01-15"
            disabled={false}
            onChange={jest.fn()}
          />
          <SettingToggle
            label="Test preference"
            description="Appearance only"
            value={false}
            disabled={false}
            onChange={jest.fn()}
          />
        </DriverSheet>
      </ApplicationAppearance>,
    );
  });
  await act(async () =>
    screen.root
      .findAll(
        n =>
          n.props.accessibilityLabel === 'Expiration date' && n.props.onPress,
      )[0]!
      .props.onPress(),
  );
  for (const mode of ['day', 'night', 'day'] as const) {
    await act(async () => {
      await services.settings.save({ ...initial, dayNightMode: mode });
    });
    const card = screen.root
      .findAllByType(View)
      .find(n => n.props.accessibilityViewIsModal)!;
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(
      mode === 'day' ? '#FFFFFF' : '#17212C',
    );
    expect(screen.root.findByType(TextInput).props.keyboardAppearance).toBe(
      mode === 'day' ? 'light' : 'dark',
    );
    expect(screen.root.findByType(Switch).props.trackColor.false).toBe(
      mode === 'day' ? '#E4E8ED' : '#2D3742',
    );
    expect(screen.root.findByType(Switch).props.thumbColor).toBe(
      mode === 'day' ? '#FFFFFF' : '#E4E8ED',
    );
    expect(
      screen.root.findAll(
        n =>
          n.props.accessibilityLabel === 'Expiration date' && n.props.onPress,
      )[0]!.props.accessibilityState.expanded,
    ).toBe(true);
    // All date-picker text stays on the same application's foreground palette.
    const date = screen.root.findByType(DocumentDateField);
    const colors = date
      .findAllByType(Text)
      .map(n => StyleSheet.flatten(n.props.style)?.color)
      .filter(Boolean);
    const allowed =
      mode === 'day'
        ? ['#101820', '#637080', '#A63D0B', '#172433']
        : ['#FFFFFF', '#B9C6D3', '#FFAB80', '#172433'];
    expect(colors.every(color => allowed.includes(color))).toBe(true);
  }
});

test.each([
  ['2026-09-17T19:00:00Z', 'dark', false],
  ['2026-09-17T07:00:00Z', 'light', true],
] as const)(
  'Automatic uses approved solar evidence at %s over system %s',
  async (iso, scheme, dark) => {
    const now = Date.parse(iso);
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const { services } = setup('system');
    services.location = Object.assign(
      new Store({
        fix: {
          latitude: 39.53,
          longitude: -119.81,
          accuracy: 10,
          timestamp: now,
        },
        tracking: true,
      }),
      { startIfPermitted: jest.fn(async () => {}) },
    ) as unknown as Services['location'];
    jest.mocked(readAppearance).mockResolvedValue('system');
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const seen: boolean[] = [];
    await act(async () => {
      screen = create(
        <ApplicationAppearance services={services}>
          <Probe seen={seen} />
        </ApplicationAppearance>,
      );
    });
    expect(new Set(seen)).toEqual(new Set([dark]));
  },
);
