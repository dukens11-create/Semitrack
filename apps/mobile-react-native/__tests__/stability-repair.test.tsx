import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  AppState,
  type AppStateStatus,
  StyleSheet,
  Text,
  useColorScheme,
} from 'react-native';
import {
  DriverPreferences,
  DriverAppearanceContext,
} from '../src/features/settings/DriverPreferences';
import { DriverButton, useDriverPalette } from '../src/components/DriverUI';
import { Card, Copy, ErrorText } from '../src/components/ui';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import { Store } from '../src/state/Store';
import type { LocationState } from '../src/services/location/LocationService';
import type { Services } from '../src/app/services';
import type { ApiClient } from '../src/services/api/ApiClient';
import { WeatherStatus } from '../src/features/weather/WeatherStatus';
import { deferred, route } from './fixtures';
import { RouteAdvisories } from '../src/features/navigation/RouteAdvisories';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));
const initial: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'metric',
  dayNightMode: 'day',
  trafficReroute: false,
  settingsJson: {
    rnTemperatureUnit: 'C',
    rnMap: { satellite: true, autoZoom: false },
    rnHiddenPoiCategories: ['medical'],
  },
};
const noon = Date.UTC(2026, 2, 20, 12);
const fix = {
  latitude: 0,
  longitude: 0,
  accuracy: 10,
  timestamp: noon,
  speed: null,
  heading: null,
};
class Locations extends Store<LocationState> {
  startIfPermitted = jest.fn().mockResolvedValue(undefined);
  update(next: LocationState) {
    this.publish(next);
  }
}
let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
function control(label: string) {
  return screen!.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
}
function setup() {
  const request = jest.fn();
  const settings = new SettingsService({ request } as unknown as ApiClient);
  const location = new Locations({ fix: null, tracking: false });
  const services = {
    settings,
    location,
    auth: { logout: jest.fn() },
  } as unknown as Services;
  return { request, settings, location, services };
}
function appearance(seen: string[]) {
  return function Probe() {
    const p = useDriverPalette();
    seen.push(p.dark ? 'night' : 'day');
    return <Text>{p.dark ? 'night' : 'day'}</Text>;
  };
}
test.each(['day', 'night'] as const)(
  '%s cold start never exposes unsaved defaults, including ten remounts',
  async mode => {
    jest
      .mocked(useColorScheme)
      .mockReturnValue(mode === 'day' ? 'dark' : 'light');
    for (let i = 0; i < 10; i++) {
      const { request, services } = setup();
      const pending = deferred<Settings>();
      request.mockReturnValue(pending.promise);
      const seen: string[] = [];
      const Probe = appearance(seen);
      await act(async () => {
        screen = create(
          <DriverPreferences services={services}>
            <Probe />
          </DriverPreferences>,
        );
      });
      expect(seen).toEqual([]);
      await act(async () =>
        pending.resolve({ ...initial, dayNightMode: mode }),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set([mode]));
      await act(async () => screen!.unmount());
      screen = undefined;
    }
  },
);
test('Automatic waits for an already-permitted solar fix and first usable render is day', async () => {
  jest.useFakeTimers({ now: noon });
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const { request, services, location } = setup();
  request.mockResolvedValue({ ...initial, dayNightMode: 'system' });
  location.update({ fix: null, tracking: true });
  const seen: string[] = [];
  const Probe = appearance(seen);
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Probe />
      </DriverPreferences>,
    );
  });
  expect(seen).toEqual([]);
  expect(location.startIfPermitted).toHaveBeenCalledTimes(1);
  await act(async () => location.update({ fix, tracking: true }));
  expect(new Set(seen)).toEqual(new Set(['day']));
});
test('Automatic has bounded neutral startup when GPS never arrives', async () => {
  jest.useFakeTimers({ now: noon });
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const { request, services, location } = setup();
  request.mockResolvedValue({ ...initial, dayNightMode: 'system' });
  location.update({ fix: null, tracking: true });
  const seen: string[] = [];
  const Probe = appearance(seen);
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Probe />
      </DriverPreferences>,
    );
  });
  await act(async () => jest.advanceTimersByTime(1199));
  expect(seen).toEqual([]);
  await act(async () => jest.advanceTimersByTime(1));
  // If location is still actively resolving, remain on the neutral startup
  // frame instead of publishing a temporary system theme that can flash.
  expect(seen).toEqual([]);
});
test('denied/unavailable location immediately uses system fallback without a permission prompt', async () => {
  const { request, services, location } = setup();
  request.mockResolvedValue({ ...initial, dayNightMode: 'system' });
  location.startIfPermitted.mockRejectedValue(new Error('unavailable'));
  jest.mocked(useColorScheme).mockReturnValue('light');
  const seen: string[] = [];
  const Probe = appearance(seen);
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Probe />
      </DriverPreferences>,
    );
  });
  expect(seen).toEqual(['day']);
});
test('failed hydration shows recoverable state; retry resolves saved settings before mounting app', async () => {
  const { request, services } = setup();
  request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(initial);
  const seen: string[] = [];
  const Probe = appearance(seen);
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Probe />
      </DriverPreferences>,
    );
  });
  expect(seen).toEqual([]);
  const retry = control('Retry saved preferences');
  await act(async () => retry.props.onPress());
  expect(new Set(seen)).toEqual(new Set(['day']));
});
test('foreground refresh preserves short-lived solar coordinates and cleans listeners/timers on unmount', async () => {
  jest.useFakeTimers({ now: noon });
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const callbacks: ((state: AppStateStatus) => void)[] = [];
  const clearTimer = jest.spyOn(globalThis, 'clearInterval');
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    callbacks.push(cb);
    return { remove };
  });
  const { request, services, location } = setup();
  request.mockResolvedValue({ ...initial, dayNightMode: 'system' });
  location.update({ fix, tracking: true });
  const seen: string[] = [];
  const Probe = appearance(seen);
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Probe />
      </DriverPreferences>,
    );
  });
  await act(async () => {
    jest.advanceTimersByTime(20000);
    location.update({ fix: null, tracking: true });
  });
  for (let i = 0; i < 5; i++)
    await act(async () => {
      callbacks[0]!('background');
      callbacks[0]!('active');
    });
  expect(new Set(seen)).toEqual(new Set(['day']));
  expect(callbacks).toHaveLength(1);
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(remove).toHaveBeenCalledTimes(1);
  expect(clearTimer).toHaveBeenCalledTimes(1);
});
test.each(['day', 'night'] as const)(
  'shared controls distinguish enabled, disabled, loading and recovery in %s mode',
  async mode => {
    const onPress = jest.fn();
    const render = (disabled: boolean, loading: boolean) => (
      <DriverAppearanceContext.Provider value={mode}>
        <DriverButton
          title="Test control"
          onPress={onPress}
          disabled={disabled}
          loading={loading}
          secondary
        />
      </DriverAppearanceContext.Provider>
    );
    await act(async () => {
      screen = create(render(false, false));
    });
    let button = control('Test control');
    expect(button.props.disabled).toBe(false);
    expect(
      StyleSheet.flatten(
        typeof button.props.style === 'function'
          ? button.props.style({ pressed: false })
          : button.props.style,
      ).opacity,
    ).toBeUndefined();
    await act(async () => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => screen!.update(render(true, false)));
    button = control('Test control');
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState.busy).toBe(false);
    await act(async () => screen!.update(render(false, true)));
    button = control('Test control');
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await act(async () => screen!.update(render(false, false)));
    expect(control('Test control').props.disabled).toBe(false);
  },
);
test('secondary screens use the same saved Night palette for text, cards and errors', async () => {
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value="night">
        <Card>
          <Copy>Readable</Copy>
          <ErrorText message="Retry available" />
        </Card>
      </DriverAppearanceContext.Provider>,
    );
  });
  const texts = screen!.root.findAllByType(Text);
  expect(
    StyleSheet.flatten(
      texts.find(n => n.props.children === 'Readable')!.props.style,
    ).color,
  ).toBe('#FFFFFF');
  expect(
    StyleSheet.flatten(
      texts.find(n => n.props.children === 'Retry available')!.props.style,
    ).color,
  ).toBe('#FFB4AB');
});
test('complete preferences survive a new service instance and rejected save retains accepted appearance', async () => {
  let saved = initial;
  const request = jest.fn(
    async (method: string, _url: string, body: Settings) => {
      if (method === 'PUT') saved = body;
      return saved;
    },
  );
  const api = { request } as unknown as ApiClient;
  const first = new SettingsService(api);
  await first.load();
  await first.save({ ...initial, dayNightMode: 'night' });
  const restarted = new SettingsService(api);
  await restarted.load();
  expect(restarted.getSnapshot().settings).toEqual({
    ...initial,
    dayNightMode: 'night',
  });
  request.mockRejectedValueOnce(new Error('offline'));
  await expect(
    restarted.save({ ...initial, dayNightMode: 'day' }),
  ).rejects.toThrow();
  expect(restarted.getSnapshot().settings).toEqual({
    ...initial,
    dayNightMode: 'night',
  });
});

test('changing route discards old warnings and pending warning responses cannot lock the next route', async () => {
  const first = {
    ...route(),
    routeGeometry: [
      [-100, 40],
      [-100.02, 40],
    ] as [number, number][],
  };
  const next = { ...first, selectedRouteId: 'next' };
  let current = first;
  const pending = deferred<Record<string, unknown>[]>();
  const gps = {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 5,
    heading: null,
    speed: 0,
  };
  const corridor = jest.fn().mockReturnValue(pending.promise);
  const services = {
    location: { getFreshFix: () => gps },
    routes: { getSnapshot: () => ({ route: current }) },
    poi: { corridor },
  } as unknown as Services;
  const render = () => (
    <RouteAdvisories services={services} route={current} fix={gps} expanded />
  );
  await act(async () => {
    screen = create(render());
  });
  await act(async () => control('Refresh road warnings').props.onPress());
  expect(control('Refresh road warnings').props.accessibilityState.busy).toBe(
    true,
  );
  current = next;
  await act(async () => screen!.update(render()));
  expect(control('Refresh road warnings').props.disabled).toBe(false);
  await act(async () =>
    pending.resolve([
      {
        id: 'old',
        title: 'Old route warning',
        source: 'test',
        observedAt: new Date().toISOString(),
        routeDistanceAheadMeters: 10,
      },
    ]),
  );
  expect(
    screen!.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .flat()
      .join(' '),
  ).not.toContain('Old route warning');
  corridor.mockResolvedValue([]);
  await act(async () => control('Refresh road warnings').props.onPress());
  expect(control('Refresh road warnings').props.disabled).toBe(false);
});

test('switching to Automatic after startup preserves the mounted navigation tree', async () => {
  const { request, services, settings, location } = setup();
  request.mockResolvedValue(initial);
  let mounts = 0,
    unmounts = 0;
  function Navigation() {
    React.useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <Text>Navigation tree</Text>;
  }
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <Navigation />
      </DriverPreferences>,
    );
  });
  await act(async () => location.update({ fix: null, tracking: true }));
  request.mockResolvedValue({ ...initial, dayNightMode: 'system' });
  await act(async () => {
    await settings.save({ ...initial, dayNightMode: 'system' });
  });
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

test('old-route weather failure cannot clear new-route observations or strand refresh loading', async () => {
  let current = route();
  const gps = {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 5,
    heading: null,
    speed: 0,
  };
  const old = deferred<Record<string, unknown>[]>();
  const routeWeather = jest
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue([
      {
        label: 'Current route location',
        status: 'AREA_OBSERVATION',
        tempF: 68,
        condition: 'Clear',
        provider: 'test',
        providerPoint: { lat: 40, lng: -100 },
        observedAt: new Date().toISOString(),
      },
    ]);
  const services = {
    settings: new Store({ settings: initial }),
    location: { getFreshFix: () => gps },
    routes: { getSnapshot: () => ({ route: current }) },
    poi: { routeWeather },
  } as unknown as Services;
  const render = () => (
    <WeatherStatus services={services} route={current} fix={gps} />
  );
  await act(async () => {
    screen = create(render());
  });
  await act(async () => control('Weather details').props.onPress());
  await act(async () => control('Refresh current weather').props.onPress());
  expect(control('Loading weather…').props.accessibilityState.busy).toBe(true);
  current = { ...current, selectedRouteId: 'new-weather-route' };
  await act(async () => screen!.update(render()));
  expect(control('Refresh current weather').props.disabled).toBe(false);
  await act(async () => control('Refresh current weather').props.onPress());
  await act(async () => old.reject(new Error('old request failed')));
  expect(
    screen!.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .flat()
      .join(' '),
  ).toContain('20°C');
  expect(control('Refresh current weather').props.disabled).toBe(false);
});
