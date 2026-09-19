import { routeDiagnostic } from '../src/features/routing/routeDiagnostic';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import {
  resolveAppearance,
  solarElevation,
} from '../src/features/settings/automaticAppearance';
import {
  recentDestinations,
  addRecent,
  saveRecent,
} from '../src/features/search/recentDestinations';
import {
  SettingsService,
  type Settings,
} from '../src/features/settings/SettingsService';
import {
  weatherPresentation,
  temperatureText,
  temperatureUnit,
  activeWeatherAlerts,
} from '../src/features/weather/weatherPresentation';
import {
  compassRotation,
  NavigationCompass,
} from '../src/features/map/NavigationCompass';
import {
  poiIcon,
  placeShortcuts,
  PoiArtwork,
} from '../src/features/poi/PoiPresentation';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { resetToken, resetPasswordError } from '../src/features/auth/resetLink';
import { PasswordRecoveryPanel } from '../src/features/auth/PasswordRecoveryPanel';
import { AuthStore } from '../src/features/auth/AuthStore';
import { TruckProfileStore } from '../src/features/truckProfile/TruckProfileStore';
import { safeDriverError } from '../src/errors/driverErrors';
import { parseTruckRoute, truckSchema } from '../src/models/contracts';
import { RoutePreview } from '../src/features/routing/RoutePreview';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { TokenVault } from '../src/services/storage/TokenVault';
import { truck as baseTruck, routeRaw } from './fixtures';
const truck = { ...baseTruck, lengthFt: 53 };
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const now = Date.UTC(2026, 2, 20, 12),
  fix = {
    latitude: 0,
    longitude: 0,
    accuracy: 10,
    timestamp: now,
    speed: null,
    heading: null,
  };
const settings: Settings = {
  voiceEnabled: true,
  voiceMuted: false,
  voiceLocale: 'en-US',
  units: 'imperial',
  dayNightMode: 'system',
  trafficReroute: false,
  settingsJson: null,
};
let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
const text = () =>
  screen.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
test('Automatic is default and falls back to system without a recent valid location', () => {
  expect(resolveAppearance('system', null, now)).toBe('system');
  expect(
    resolveAppearance('system', { ...fix, timestamp: now - 300001 }, now),
  ).toBe('system');
  expect(resolveAppearance('system', { ...fix, latitude: NaN }, now)).toBe(
    'system',
  );
  expect(resolveAppearance('system', { ...fix, latitude: 80 }, now)).toBe(
    'system',
  );
});
test('solar appearance transitions without a restart; manual overrides win', () => {
  expect(solarElevation(now, 0, 0)).toBeGreaterThan(80);
  expect(resolveAppearance('system', fix, now)).toBe('day');
  const midnight = now + 12 * 3600000;
  expect(
    resolveAppearance('system', { ...fix, timestamp: midnight }, midnight),
  ).toBe('night');
  expect(resolveAppearance('night', fix, now)).toBe('night');
  expect(
    resolveAppearance('day', { ...fix, timestamp: midnight }, midnight),
  ).toBe('day');
});
test('transition hysteresis preserves the preceding appearance near sunrise', () => {
  const t = Array.from(
    { length: 1440 },
    (_, m) => Date.UTC(2026, 2, 20) + m * 60000,
  ).find(v => {
    const e = solarElevation(v, 0, 0);
    return e > -1.08 && e < -0.59;
  })!;
  expect(t).toBeDefined();
  expect(
    resolveAppearance('system', { ...fix, timestamp: t }, t, 'night'),
  ).toBe('night');
  expect(resolveAppearance('system', { ...fix, timestamp: t }, t, 'day')).toBe(
    'day',
  );
});
test('appearance, temperature and history persist through the existing settings endpoint', async () => {
  let saved = settings;
  const request = jest.fn(
    async (method: string, _path: string, body: Settings) => {
      if (method === 'PUT') saved = body;
      return saved;
    },
  );
  const service = new SettingsService({ request } as unknown as ApiClient);
  await service.load();
  await service.save({
    ...settings,
    dayNightMode: 'night',
    settingsJson: { rnTemperatureUnit: 'C' },
  });
  await saveRecent(service, items =>
    addRecent(items, '465 Driver-entered Road'),
  );
  const restarted = new SettingsService({ request } as unknown as ApiClient);
  await restarted.load();
  expect(restarted.getSnapshot().settings?.dayNightMode).toBe('night');
  expect(temperatureUnit(restarted.getSnapshot().settings)).toBe('C');
  expect(recentDestinations(restarted.getSnapshot().settings, '465')).toEqual([
    '465 Driver-entered Road',
  ]);
  await saveRecent(restarted, () => []);
  expect(recentDestinations(restarted.getSnapshot().settings)).toEqual([]);
});
test('recent queries deduplicate, filter, remove and never retain provider coordinates or routes', () => {
  const items = addRecent(['Old address', '465 Road'], '465 road');
  expect(items).toEqual(['465 road', 'Old address']);
  const state = {
    ...settings,
    settingsJson: {
      rnRecentDestinations: [...items, { lat: 40, lng: -100 }, ''],
    },
  };
  expect(recentDestinations(state, '465')).toEqual(['465 road']);
  expect(items.filter(i => i !== '465 road')).toEqual(['Old address']);
});
test.each([0, 90, 180, 270, 450, -90])(
  'compass uses opposite rotation for camera bearing %s',
  bearing => {
    expect(compassRotation(bearing)).toBe(-(((bearing % 360) + 360) % 360));
  },
);
test('compass does not invent an unavailable bearing and displays N/S when known', async () => {
  expect(compassRotation(null)).toBeNull();
  expect(compassRotation(NaN)).toBeNull();
  await act(async () => {
    screen = create(<NavigationCompass bearing={90} />);
  });
  expect(text()).toContain('N');
  expect(text()).toContain('S');
  await act(async () => screen.update(<NavigationCompass bearing={0} />));
  expect(
    screen.root.findAll(n => n.props.testID === 'compass-needle')[0]!.props
      .style[1].transform,
  ).toEqual([{ rotate: '0deg' }]);
  await act(async () => screen.update(<NavigationCompass bearing={null} />));
  expect(text()).toBe('—');
});
test('all exposed POI categories have semantic icons and scales are distinct', () => {
  expect(placeShortcuts).toHaveLength(7);
  for (const p of placeShortcuts) expect(poiIcon(p.category)).toBe(p.icon);
  expect(poiIcon('truck_stop')).not.toBe('restaurant_rounded');
  expect(poiIcon('weigh_station')).not.toBe(poiIcon('cat_scale'));
  expect(poiIcon('truck_wash')).toBe('truck_wash_symbol');
  expect(poiIcon('truck_repair')).toBe('truck_repair_symbol');
  expect(poiIcon('restaurant')).toBe('restaurant_rounded');
});
test.each(['day', 'night'] as const)(
  'POIs render supplied pictures in %s appearance',
  async mode => {
    await act(async () => {
      screen = create(
        <DriverAppearanceContext.Provider value={mode}>
          <PoiArtwork
            poi={{
              id: 'p',
              name: 'Truck stop',
              category: 'truck_stop',
              latitude: 40,
              longitude: -100,
            }}
          />
        </DriverAppearanceContext.Provider>,
      );
    });
    expect(
      screen.root.findAll(n => n.props.testID === 'poi-picture-truck_stop')
        .length,
    ).toBeGreaterThan(0);
  },
);
const weather = {
  status: 'AREA_OBSERVATION',
  tempF: 72,
  condition: 'Clear',
  provider: 'OpenWeather',
  providerPoint: { lat: 0, lng: 0 },
  observedAt: new Date(now).toISOString(),
};
test('real weather temperature uses the same value for Fahrenheit/Celsius', () => {
  expect(weatherPresentation(weather, fix, now).status).toBe('CURRENT');
  expect(temperatureText(32, 'C')).toBe('0°C');
  expect(temperatureText(212, 'C')).toBe('100°C');
  expect(temperatureText(72, 'F')).toBe('72°F');
  expect(temperatureUnit(null)).toBe('F');
});
test.each([
  undefined,
  { ...weather, tempF: NaN },
  { ...weather, provider: '' },
  { ...weather, status: 'UNAVAILABLE' },
  { ...weather, observedAt: 'not a date' },
])('unproven weather is unavailable: %j', raw =>
  expect(weatherPresentation(raw, fix, now).status).toBe('UNAVAILABLE'),
);
test('stale or distant weather is never shown as current', () => {
  expect(
    weatherPresentation(
      { ...weather, observedAt: new Date(now - 7200001).toISOString() },
      fix,
      now,
    ).status,
  ).toBe('STALE');
  expect(
    weatherPresentation(weather, { ...fix, latitude: 10 }, now).status,
  ).toBe('STALE');
});
test('weather does not infer severe alerts from ordinary rain or temperature', () => {
  expect(activeWeatherAlerts(undefined, now)).toEqual([]);
  expect(activeWeatherAlerts([{ condition: 'Rain', tempF: 100 }], now)).toEqual(
    [],
  );
  const alert = {
    title: 'High wind warning',
    severity: 'SEVERE',
    provider: 'Test official provider',
    areaVerified: true,
    expiresAt: new Date(now + 60000).toISOString(),
  };
  expect(activeWeatherAlerts([alert], now)).toEqual([alert]);
  expect(
    activeWeatherAlerts(
      [
        { ...alert, areaVerified: false },
        { ...alert, expiresAt: new Date(now - 1).toISOString() },
      ],
      now,
    ),
  ).toEqual([]);
});
test('saved verified default is reused after a new store instance, but legacy profiles are not', async () => {
  const request = jest.fn().mockResolvedValue({ items: [truck] });
  const store = new TruckProfileStore(
    { request } as unknown as ApiClient,
    jest.fn(),
  );
  await store.load();
  expect(store.getSnapshot().selected?.id).toBe(truck.id);
  request.mockResolvedValue({ items: [{ ...truck, verifiedRevision: null }] });
  await store.load();
  expect(store.getSnapshot().selected).toBeNull();
});
test('changed routing-critical profile invalidates the old route even if subsequently verified', async () => {
  let current = truck;
  const changed = jest.fn();
  const store = new TruckProfileStore(
    { request: async () => ({ items: [current] }) } as unknown as ApiClient,
    changed,
  );
  await store.load();
  current = { ...truck, heightFt: 14, revision: 2, verifiedRevision: 2 };
  await store.load();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().selected).toBeNull();
});
test('ambiguous verified defaults do not auto-select a truck', async () => {
  const store = new TruckProfileStore(
    {
      request: async () => ({ items: [truck, { ...truck, id: 'other' }] }),
    } as unknown as ApiClient,
    jest.fn(),
  );
  await store.load();
  expect(store.getSnapshot().selected).toBeNull();
});
test('valid verified route with explicit unsupported preference stays a preview and shows that warning', async () => {
  const route = parseTruckRoute({
    ...routeRaw,
    preferenceWarnings: [
      {
        code: 'OPTIONAL_PREFERENCE_UNSUPPORTED',
        preference: 'avoidHighways',
        requested: true,
        supported: false,
        guaranteed: false,
        message: 'Test warning',
      },
    ],
  });
  await act(async () => {
    screen = create(<RoutePreview route={route} metric={false} />);
  });
  expect(text()).toContain(
    'Highway avoidance was requested but is not guaranteed',
  );
  expect(route.truckSafe).toBe(true);
  expect(() => parseTruckRoute({ ...routeRaw, truckSafe: false })).toThrow();
  expect(() => parseTruckRoute({ ...routeRaw, provider: 'Mapbox' })).toThrow();
});
test.each([
  'TRIMBLE_AUTHORIZATION_FAILED',
  'TRIMBLE_API_KEY_MISSING',
  'TRIMBLE_NETWORK_ERROR',
])(
  'routing infrastructure failure %s is not described as a road restriction',
  code => {
    const message = safeDriverError({ code });
    expect(message).not.toContain('restriction or warning');
    expect(message).not.toContain('Review your truck profile');
  },
);
test('restriction errors remain fail-closed and invalid height gets a specific safe message', () => {
  expect(safeDriverError({ code: 'TRIMBLE_RESTRICTION_WARNING' })).toContain(
    'No verified truck route',
  );
  expect(
    safeDriverError({ code: 'TRIMBLE_RESTRICTION_UNSUPPORTED' }),
  ).toContain('cannot guarantee');
  const result = truckSchema.safeParse({ ...truck, heightFt: NaN });
  if (result.success) throw Error('must reject');
  expect(safeDriverError(result.error)).toContain(
    'Truck height needs attention',
  );
});
test('recovery parses links/tokens without navigating and rejects malformed input', () => {
  const token = 'A'.repeat(64);
  expect(resetToken('https://example.test/reset?token=' + token)).toBe(token);
  expect(resetToken(token)).toBe(token);
  expect(resetToken('http://example.test/reset?token=' + token)).toBeNull();
  expect(resetToken('invalid')).toBeNull();
  expect(resetPasswordError('short', 'short')).toContain('10');
  expect(resetPasswordError('a'.repeat(73), 'a'.repeat(73))).toContain('72');
  expect(resetPasswordError('new-password', 'other')).toContain('match');
});
test('reset uses the existing unauthenticated API contract', async () => {
  const request = jest.fn().mockResolvedValue(undefined),
    auth = new AuthStore({ request } as unknown as ApiClient, {} as TokenVault);
  await auth.confirmPasswordReset('A'.repeat(64), 'valid-new-password');
  expect(request).toHaveBeenCalledWith(
    'POST',
    '/auth/password-reset/confirm',
    { token: 'A'.repeat(64), password: 'valid-new-password' },
    undefined,
    false,
  );
});
test.each([false, true])(
  'reset completion and invalid/expired token UI: error=%s',
  async fail => {
    const confirmPasswordReset = fail
      ? jest.fn().mockRejectedValue({ code: 'INVALID_RESET_TOKEN' })
      : jest.fn().mockResolvedValue(undefined);
    const close = jest.fn();
    await act(async () => {
      screen = create(
        <PasswordRecoveryPanel
          auth={{ confirmPasswordReset } as unknown as AuthStore}
          onClose={close}
        />,
      );
    });
    for (const [label, value] of [
      ['Recovery link', 'A'.repeat(64)],
      ['New password', 'valid-new-password'],
      ['Confirm new password', 'valid-new-password'],
    ])
      await act(async () =>
        screen.root
          .findAllByType(TextInput)
          .find(n => n.props.accessibilityLabel === label)!
          .props.onChangeText(value),
      );
    await act(async () =>
      screen.root
        .findAll(
          n =>
            n.props.accessibilityLabel === 'Reset password' &&
            typeof n.props.onPress === 'function',
        )[0]!
        .props.onPress(),
    );
    expect(confirmPasswordReset).toHaveBeenCalledTimes(1);
    if (fail) {
      expect(text()).toContain('invalid, expired, or already used');
      expect(text()).not.toContain('valid-new-password');
    } else {
      expect(text()).toContain('Password reset successfully');
      await act(async () =>
        screen.root
          .findAll(
            n =>
              n.props.accessibilityLabel === 'Return to Sign In' &&
              typeof n.props.onPress === 'function',
          )[0]!
          .props.onPress(),
      );
      expect(close).toHaveBeenCalled();
    }
  },
);

test('diagnostics allowlist codes and fields; provider text, credentials and locations never escape', () => {
  const secret = 'secret-value-and-private-address';
  const info = routeDiagnostic({
    code: secret,
    status: 502,
    message: secret,
    validationFields: [secret],
  });
  expect(JSON.stringify(info)).not.toContain(secret);
  expect(info.code).toBe('UNCLASSIFIED_ERROR');
  expect(info.category).toBe('BACKEND');
  const warning = routeDiagnostic({
    code: 'TRIMBLE_RESTRICTION_WARNING',
    status: 422,
    message: secret,
  });
  expect(warning.category).toBe('UNCLASSIFIED_PROVIDER_WARNING');
  expect(warning.providerDetailAvailable).toBe(false);
  expect(JSON.stringify(warning)).not.toContain(secret);
  expect(
    routeDiagnostic({
      code: 'VALIDATION_ERROR',
      validationFields: ['heightFt', secret],
    }).message,
  ).toContain('Truck height needs attention');
});
