import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Clipboard, Modal, Share, StyleSheet, Text, View } from 'react-native';
import { DiagnosticsScreen } from '../src/screens/DiagnosticsScreen';
import { ThemedAlertHost } from '../src/components/ThemedAlert';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import {
  beginRouteDiagnostic,
  clearRouteDiagnostics,
  emitRouteDiagnostic,
  recordRouteFailure,
  routeDiagnosticHistory,
  subscribeRouteDiagnostics,
} from '../src/features/routing/routeTelemetry';
import { routeDiagnosticReport } from '../src/features/routing/routeDiagnosticReport';
import { route, truck } from './fixtures';
import { RouteStore } from '../src/features/routing/RouteStore';
import { TruckProfileStore } from '../src/features/truckProfile/TruckProfileStore';
import type { TruckRoutingService } from '../src/services/routing/TruckRoutingService';
import type { ApiClient } from '../src/services/api/ApiClient';

let screen: ReactTestRenderer;
let copy: jest.SpyInstance;
let share: jest.SpyInstance;
beforeEach(() => {
  clearRouteDiagnostics();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
  share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction });
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  clearRouteDiagnostics();
  jest.restoreAllMocks();
});
async function setup(mode: 'day' | 'night' = 'day') {
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <DiagnosticsScreen />
        <ThemedAlertHost />
      </DriverAppearanceContext.Provider>,
    );
  });
}
const content = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat(Infinity))
    .join('');
const buttons = (label: string) =>
  screen.root.findAll(
    node =>
      node.props?.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
async function press(label: string, last = false) {
  await act(async () => {
    const matches = buttons(label);
    await (last ? matches.at(-1)! : matches[0]!).props.onPress();
  });
}
function warning() {
  const attempt = beginRouteDiagnostic(truck, 3);
  emitRouteDiagnostic({
    attempt,
    stage: 'BACKEND_HTTP',
    backendHttpStatus: 422,
    responseReceived: true,
  });
  recordRouteFailure(attempt, 'BACKEND_ERROR', {
    code: 'TRIMBLE_RESTRICTION_WARNING',
    status: 422,
    restrictionDiagnostic: {
      source: 'TRIMBLE_DIRECTIONS_REPORT',
      category: 'UNCLASSIFIED_PROVIDER_WARNING',
      providerWarningTypes: [4],
      providerTextPresent: true,
      legNumber: 2,
      lineNumber: 3,
    },
  });
}

test('empty state has no invented route data and disables history actions', async () => {
  await setup();
  expect(content()).toContain('No route diagnostics recorded yet');
  for (const name of [
    'Copy Diagnostics',
    'Share Diagnostics',
    'Clear Diagnostics',
  ]) {
    expect(buttons(name)[0]!.props.disabled).toBe(true);
  }
  expect(copy).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
});

test('live history records real collection times and shows warning rejection chronologically', async () => {
  await setup();
  const before = Date.now();
  await act(async () => warning());
  const events = routeDiagnosticHistory();
  for (const event of events)
    expect(Date.parse(String(event.recordedAt))).toBeGreaterThanOrEqual(before);
  expect(content()).not.toContain('No route diagnostics recorded yet');
  const text = content();
  expect(text.indexOf('REQUEST_PROFILE')).toBeLessThan(
    text.indexOf('BACKEND_HTTP'),
  );
  expect(text.indexOf('BACKEND_HTTP')).toBeLessThan(
    text.indexOf('WARNING_ORIGIN'),
  );
  expect(text.indexOf('WARNING_ORIGIN')).toBeLessThan(text.indexOf('DECISION'));
  expect(text).toContain('Backend HTTP status: 422');
  expect(text).toContain('Result: REJECTED');
  expect(text).toContain('Reason identifier: TRIMBLE_RESTRICTION_WARNING');
  expect(text).toContain('Required OverrideRestrict: false');
  expect(text).toContain('Observed provider OverrideRestrict: NOT_OBSERVED');
  expect(text).toContain('Provider HTTP status: NOT_OBSERVED');
  expect(text).toContain('Passenger fallback: NO');
  expect(text).not.toContain('Result: ACCEPTED');
});

test('render, clipboard and share reject secrets, identity, precise locations and raw payloads', async () => {
  const sensitive = {
    apiKey: 'SECRET_TRIMBLE_API_KEY',
    mapboxToken: 'pk.SECRET_MAPBOX_TOKEN',
    authorization: 'Bearer SECRET_AUTH_HEADER',
    accessToken: 'SECRET_ACCESS_TOKEN',
    refreshToken: 'SECRET_REFRESH_TOKEN',
    password: 'SECRET_PASSWORD',
    lat: 39.12345678,
    lng: -119.87654321,
    address: '123 PRIVATE ADDRESS LANE',
    fullName: 'PRIVATE DRIVER NAME',
    email: 'private.identity@example.test',
    requestBody: 'RAW_REQUEST_BODY',
    responseBody: 'RAW_RESPONSE_BODY',
  };
  const forbidden = Object.values(sensitive).map(String);
  const attempt = beginRouteDiagnostic({ ...truck, ...sensitive }, 3);
  emitRouteDiagnostic({
    attempt,
    stage: 'REQUEST_VALIDATION',
    result: 'PASS',
    ...sensitive,
    recordedAt: 'SECRET_EXTERNAL_TIMESTAMP',
    provider: sensitive.apiKey,
  });
  for (const value of forbidden) {
    emitRouteDiagnostic({
      attempt,
      stage: 'UI_WARNING',
      reason: value,
      message: value,
    });
    // Known schema fields also refuse untrusted text, not just extra fields.
    emitRouteDiagnostic({
      attempt,
      stage: 'BACKEND_HTTP',
      backendHttpStatus: value,
    });
  }
  recordRouteFailure(attempt, 'BACKEND_ERROR', {
    ...sensitive,
    code: 'TRIMBLE_RESTRICTION_WARNING',
    status: 422,
    restrictionDiagnostic: {
      ...sensitive,
      source: 'TRIMBLE_DIRECTIONS_REPORT',
      category: 'UNCLASSIFIED_PROVIDER_WARNING',
      providerWarningTypes: [4, sensitive.apiKey],
      providerTextPresent: true,
      legNumber: 2,
      lineNumber: 3,
      message: sensitive.address,
    },
  });
  await setup();
  await press('Copy Diagnostics');
  await press('Share Diagnostics');
  expect(copy).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenCalledTimes(1);
  const copied = copy.mock.calls[0]![0];
  const shared = share.mock.calls[0]![0];
  expect(copied).toBe(routeDiagnosticReport().text);
  expect(shared).toEqual({
    title: 'SemiTraX Route Diagnostics',
    message: copied,
  });
  for (const surface of [
    JSON.stringify(screen.toJSON()),
    copied,
    JSON.stringify(shared),
  ]) {
    for (const value of [...forbidden, 'SECRET_EXTERNAL_TIMESTAMP'])
      expect(surface).not.toContain(value);
    expect(surface).toContain('TRIMBLE_RESTRICTION_WARNING');
    expect(surface).toContain('REJECTED');
  }
});

test('copy and share read latest collected history at action time', async () => {
  await setup();
  await act(async () => warning());
  await press('Copy Diagnostics');
  await act(async () =>
    emitRouteDiagnostic({
      attempt: 123,
      stage: 'UI_WARNING',
      reason: 'TRIMBLE_INCOMPLETE_ROUTE',
    }),
  );
  await press('Share Diagnostics');
  expect(copy.mock.calls[0]![0]).not.toContain('TRIMBLE_INCOMPLETE_ROUTE');
  expect(share.mock.calls[0]![0].message).toContain('TRIMBLE_INCOMPLETE_ROUTE');
});

test('clear requires confirmation; cancel and Android modal Back preserve history', async () => {
  warning();
  await setup();
  const original = routeDiagnosticHistory();
  await press('Clear Diagnostics');
  expect(routeDiagnosticHistory()).toEqual(original);
  await press('Cancel');
  expect(routeDiagnosticHistory()).toEqual(original);
  await press('Clear Diagnostics');
  await act(async () => screen.root.findByType(Modal).props.onRequestClose());
  expect(routeDiagnosticHistory()).toEqual(original);
});

test('confirmed clear clears only history and later attempts can still record', async () => {
  const calculate = jest.fn(async () => route());
  const routes = new RouteStore({
    calculate,
  } as unknown as TruckRoutingService);
  const request = jest.fn(async () => ({ items: [truck] }));
  const profiles = new TruckProfileStore(
    { request } as unknown as ApiClient,
    jest.fn(),
  );
  await profiles.load();
  await routes.calculate(
    { lat: 40, lng: -100 },
    {
      destination: {
        id: 'synthetic',
        name: 'TEST ONLY',
        lat: 40,
        lng: -100.02,
      },
      stops: [],
    },
    truck,
  );
  const routeBefore = routes.getSnapshot();
  const profilesBefore = profiles.getSnapshot();
  expect(routeBefore.phase).toBe('preview');
  expect(profilesBefore.profiles).toHaveLength(1);
  const originalTruck = JSON.stringify(truck);
  warning();
  const previousAttempt = Number(routeDiagnosticHistory()[0]!.attempt);
  await setup();
  await press('Clear Diagnostics');
  await press('Clear Diagnostics', true);
  expect(routeDiagnosticHistory()).toEqual([]);
  expect(content()).toContain('No route diagnostics recorded yet');
  expect(JSON.stringify(truck)).toBe(originalTruck);
  expect(routes.getSnapshot()).toBe(routeBefore);
  expect(profiles.getSnapshot()).toBe(profilesBefore);
  expect(calculate).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  let attempt = 0;
  await act(async () => {
    attempt = beginRouteDiagnostic(truck, 2);
  });
  expect(attempt).toBeGreaterThan(previousAttempt);
  expect(content()).toContain('Stop count: 2');
});

test.each(['day', 'night'] as const)(
  '%s event cards and clear dialog use the application palette',
  async mode => {
    warning();
    await setup(mode);
    const event = screen.root
      .findAllByType(Text)
      .find(node => node.props.selectable)!;
    expect(StyleSheet.flatten(event.props.style).color).toBe(
      mode === 'day' ? '#101820' : '#FFFFFF',
    );
    const backgrounds = () =>
      screen.root
        .findAllByType(View)
        .map(node => StyleSheet.flatten(node.props.style)?.backgroundColor);
    expect(backgrounds()).toContain(mode === 'day' ? '#FFFFFF' : '#17212C');
    await press('Clear Diagnostics');
    const dialog = screen.root
      .findAllByType(View)
      .find(node => node.props.accessibilityViewIsModal)!;
    expect(StyleSheet.flatten(dialog.props.style).backgroundColor).toBe(
      mode === 'day' ? '#FFFFFF' : '#17212C',
    );
    await press('Cancel');
  },
);

test.each(['copy', 'share'] as const)(
  '%s failures cannot expose native error contents',
  async action => {
    warning();
    await setup();
    const secret = 'SECRET_PLATFORM_ERROR_WITH_ADDRESS';
    if (action === 'copy')
      copy.mockImplementation(() => {
        throw new Error(secret);
      });
    else share.mockRejectedValue(new Error(secret));
    await press(action === 'copy' ? 'Copy Diagnostics' : 'Share Diagnostics');
    expect(content()).toContain('Could not');
    expect(JSON.stringify(screen.toJSON())).not.toContain(secret);
  },
);

test('history remains bounded; subscriber or log sink failure cannot interrupt collection', () => {
  const broken = subscribeRouteDiagnostics(() => {
    throw new Error('viewer failure');
  });
  const healthy = jest.fn();
  const unsubscribe = subscribeRouteDiagnostics(healthy);
  jest.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('log sink failure');
  });
  for (let attempt = 1; attempt <= 45; attempt++) {
    expect(() =>
      emitRouteDiagnostic({ attempt, stage: 'DECISION', result: 'REJECTED' }),
    ).not.toThrow();
  }
  expect(routeDiagnosticHistory()).toHaveLength(40);
  expect(routeDiagnosticHistory()[0]!.attempt).toBe(6);
  expect(healthy).toHaveBeenCalledTimes(45);
  broken();
  unsubscribe();
  clearRouteDiagnostics();
  expect(healthy).toHaveBeenCalledTimes(45);
});
