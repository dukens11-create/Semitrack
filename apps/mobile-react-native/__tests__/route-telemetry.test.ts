import { ApiClient } from '../src/services/api/ApiClient';
import { TruckRoutingService } from '../src/services/routing/TruckRoutingService';
import { RouteStore } from '../src/features/routing/RouteStore';
import {
  emitRouteDiagnostic,
  routeDiagnosticHistory,
  beginRouteDiagnostic,
  recordRouteFailure,
} from '../src/features/routing/routeTelemetry';
import { MemoryVault, reply, truck, routeRaw } from './fixtures';

// Synthetic, local-only fixtures. Never contact any real backend/provider.
const origin = { lat: 40, lng: -100 };
const plan = {
  destination: {
    id: 'private-id',
    name: 'PRIVATE ADDRESS',
    lat: 40,
    lng: -100.02,
  },
  stops: [],
};
const warning = {
  source: 'TRIMBLE_DIRECTIONS_REPORT',
  category: 'UNCLASSIFIED_PROVIDER_WARNING',
  providerWarningTypes: [4],
  providerTextPresent: true,
  legNumber: 2,
  lineNumber: 3,
};
let sink: jest.SpyInstance;
beforeEach(() => {
  sink = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  sink.mockRestore();
});
const events = () =>
  sink.mock.calls.map(call =>
    JSON.parse(String(call[0]).replace(/^SEMITRAX_ROUTE_DIAG /, '')),
  );
function setup(data: unknown, status = 200) {
  const transport = jest.fn(async () => reply(data, status));
  const api = new ApiClient(
    'https://fixture.invalid',
    new MemoryVault({
      accessToken: 'PRIVATE_ACCESS_TOKEN',
      refreshToken: 'PRIVATE_REFRESH_TOKEN',
    }),
    transport as typeof fetch,
  );
  return { transport, api, service: new TruckRoutingService(api) };
}
function success() {
  return {
    ...routeRaw,
    validatedStops: [origin, plan.destination],
    legs: [
      {
        distanceMiles: 12,
        durationSeconds: 1200,
        geometry: routeRaw.routeGeometry,
        maneuvers: routeRaw.turnByTurn,
      },
    ],
  };
}
test('backend warning remains rejected and identifies the allowlisted Directions Report origin', async () => {
  const { service, transport } = setup(
    {
      error: {
        code: 'TRIMBLE_RESTRICTION_WARNING',
        restrictionDiagnostic: warning,
      },
    },
    422,
  );
  await expect(service.calculate(origin, plan, truck)).rejects.toMatchObject({
    code: 'TRIMBLE_RESTRICTION_WARNING',
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(events().filter(e => e.stage === 'BACKEND_HTTP')).toHaveLength(1);
  expect(events()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: 'BACKEND_HTTP',
        backendHttpStatus: 422,
        responseReceived: true,
        providerHttpStatus: 'NOT_OBSERVED',
      }),
      expect.objectContaining({
        stage: 'WARNING_ORIGIN',
        source: 'PROVIDER_RESTRICTION',
        providerWarningTypes: [4],
        legNumber: 2,
        lineNumber: 3,
      }),
      expect.objectContaining({ stage: 'DECISION', result: 'REJECTED' }),
    ]),
  );
  expect(events().some(e => e.result === 'ACCEPTED')).toBe(false);
});
test.each([
  undefined,
  { ...warning, source: 'SECRET' },
  { ...warning, lineNumber: -1 },
])(
  'absent or malformed backend details cannot invent a warning origin (%p)',
  async detail => {
    const { service } = setup(
      {
        error: {
          code: 'TRIMBLE_RESTRICTION_WARNING',
          restrictionDiagnostic: detail,
        },
      },
      422,
    );
    await expect(service.calculate(origin, plan, truck)).rejects.toBeDefined();
    expect(events()).toContainEqual(
      expect.objectContaining({
        stage: 'WARNING_ORIGIN',
        source: 'UNKNOWN',
        warningEvidence: 'ABSENT_OR_INVALID',
      }),
    );
  },
);
test('invalid saved truck fails locally and never calls transport', async () => {
  const { service, transport } = setup({});
  await expect(
    service.calculate(origin, plan, { ...truck, verifiedRevision: 99 }),
  ).rejects.toBeDefined();
  expect(transport).not.toHaveBeenCalled();
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'REQUEST_VALIDATION',
      source: 'LOCAL_VALIDATION',
      result: 'FAIL',
    }),
  );
  expect(events().some(e => e.stage === 'BACKEND_HTTP')).toBe(false);
});
test('invalid serialized dimensions fail at construction without leaking raw values', async () => {
  const { service, transport } = setup({});
  await expect(
    service.calculate(origin, plan, { ...truck, heightFt: 9999.125 }),
  ).rejects.toBeDefined();
  expect(transport).not.toHaveBeenCalled();
  expect(events()).toContainEqual(
    expect.objectContaining({ stage: 'REQUEST_CONSTRUCTION', result: 'FAIL' }),
  );
  expect(JSON.stringify(events())).not.toContain('9999.125');
});
test('200 malformed route fails the client contract without invented provider evidence', async () => {
  const { service } = setup({});
  await expect(service.calculate(origin, plan, truck)).rejects.toMatchObject({
    code: 'ROUTE_CONTRACT_INVALID',
  });
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'RESPONSE_PARSE',
      reason: 'ROUTE_CONTRACT_INVALID',
      result: 'FAIL',
    }),
  );
});
test('successful local contract fixture reports acceptance without altering truck request', async () => {
  const { service, transport } = setup(success());
  await expect(service.calculate(origin, plan, truck)).resolves.toMatchObject({
    truckSafe: true,
    navigationAllowed: true,
  });
  expect(events()).toContainEqual(
    expect.objectContaining({ stage: 'DECISION', result: 'ACCEPTED' }),
  );
  const sent = JSON.parse(
    (transport.mock.calls as unknown as [string, RequestInit][])[0]![1]
      .body as string,
  );
  expect(sent.truck).toMatchObject({
    heightFt: 13.5,
    widthFt: 8.5,
    lengthFt: 72,
    weightLbs: 80000,
    axleCount: 5,
    trailerCount: 1,
    hazmatEnabled: true,
    hazardousGoods: ['flammable'],
  });
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'REQUEST_PROFILE',
      units: 'FT_LB',
      expectedOverrideRestrict: false,
      actualProviderOverrideRestrict: 'NOT_OBSERVED',
      passengerFallback: 'NO',
    }),
  );
});
test('log and share projection drop credentials, exact locations, identities, URLs and raw provider payloads', async () => {
  const secrets = {
    apiKey: 'PRIVATE_TRIMBLE_KEY',
    mapbox: 'pk.PRIVATE_MAPBOX_TOKEN',
    Authorization: 'Bearer PRIVATE_AUTH',
    accessToken: 'PRIVATE_ACCESS_TOKEN',
    refreshToken: 'PRIVATE_REFRESH_TOKEN',
    url: 'https://private.invalid/?key=PRIVATE_URL_KEY',
    origin: { lat: 39.12345678, lng: -119.87654321 },
    address: '987 PRIVATE ADDRESS',
    user: 'PRIVATE_USER',
    payload: { Warn: 'PRIVATE_PROVIDER_PAYLOAD' },
    message: 'PRIVATE_SERVER_MESSAGE',
  };
  const { service } = setup(
    {
      error: {
        ...secrets,
        code: 'TRIMBLE_RESTRICTION_WARNING',
        restrictionDiagnostic: { ...warning, ...secrets },
      },
    },
    422,
  );
  await expect(
    service.calculate({ ...origin, lat: 39.12345678 }, plan, {
      ...truck,
      name: 'PRIVATE_USER',
    }),
  ).rejects.toBeDefined();
  emitRouteDiagnostic({
    attempt: 99,
    stage: 'BACKEND_ERROR',
    reason: 'PRIVATE_SECRET_REASON',
    ...secrets,
  });
  const output = JSON.stringify({
    logs: events(),
    share: routeDiagnosticHistory(),
  });
  expect(output).not.toMatch(
    /PRIVATE_|39.12345678|-119.87654321|Authorization|apiKey|accessToken|refreshToken|private.invalid/,
  );
  expect(events()).toContainEqual(
    expect.objectContaining({ reason: 'UNCLASSIFIED_ERROR' }),
  );
});
test('unapproved enum values cannot smuggle data through trusted fields', () => {
  for (const key of [
    'stage',
    'source',
    'result',
    'hazmat',
    'dimensions',
    'warningEvidence',
  ]) {
    const before = sink.mock.calls.length;
    emitRouteDiagnostic({
      attempt: 1,
      stage: 'BACKEND_ERROR',
      [key]: 'PRIVATE_SECRET',
    });
    expect(sink).toHaveBeenCalledTimes(before);
  }
});
test('diagnostic sink failure never changes route success or failure', async () => {
  sink.mockImplementation(() => {
    throw new Error('sink unavailable');
  });
  await expect(
    setup(success()).service.calculate(origin, plan, truck),
  ).resolves.toMatchObject({ truckSafe: true });
  await expect(
    setup(
      { error: { code: 'TRIMBLE_RESTRICTION_WARNING' } },
      422,
    ).service.calculate(origin, plan, truck),
  ).rejects.toMatchObject({ code: 'TRIMBLE_RESTRICTION_WARNING' });
});
test('network failure does not claim a received backend or Trimble HTTP response', async () => {
  const transport = jest.fn(async () => {
    throw new Error('PRIVATE_NETWORK_URL');
  });
  const api = new ApiClient(
    'https://fixture.invalid',
    new MemoryVault(),
    transport,
  );
  await expect(
    new TruckRoutingService(api).calculate(origin, plan, truck),
  ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
  expect(events().some(e => e.stage === 'BACKEND_HTTP')).toBe(false);
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'BACKEND_ERROR',
      source: 'UNKNOWN',
      reason: 'NETWORK_UNAVAILABLE',
    }),
  );
});
test('UI warning state correlates with the rejected attempt and remains shareable', async () => {
  const { service } = setup(
    {
      error: {
        code: 'TRIMBLE_RESTRICTION_WARNING',
        restrictionDiagnostic: warning,
      },
    },
    422,
  );
  const store = new RouteStore(service);
  expect(await store.calculate(origin, plan, truck)).toBe(false);
  expect(new Set(events().map(e => e.attempt)).size).toBe(1);
  expect(events().filter(e => e.stage === 'UI_WARNING')).toHaveLength(1);
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'UI_WARNING',
      reason: 'TRIMBLE_RESTRICTION_WARNING',
    }),
  );
});
test('trace is bounded, copied, and carries no user-derived request identifier', () => {
  for (let i = 0; i < 50; i++) beginRouteDiagnostic(truck, 2);
  const copy = routeDiagnosticHistory();
  expect(copy).toHaveLength(40);
  copy[0]!.stage = 'PRIVATE_MUTATION';
  expect(JSON.stringify(routeDiagnosticHistory())).not.toContain(
    'PRIVATE_MUTATION',
  );
});
test('non-backend warning-shaped error cannot assert provider origin', () => {
  recordRouteFailure(beginRouteDiagnostic(truck, 2), 'REQUEST_VALIDATION', {
    code: 'TRIMBLE_RESTRICTION_WARNING',
    restrictionDiagnostic: warning,
  });
  expect(events()).toContainEqual(
    expect.objectContaining({ stage: 'WARNING_ORIGIN', source: 'UNKNOWN' }),
  );
});

test('invalid JSON records actual backend HTTP and rejects before the route parser', async () => {
  const transport = jest.fn(
    async () =>
      ({
        status: 200,
        ok: true,
        text: async () => '{PRIVATE_PAYLOAD',
      } as Response),
  );
  const api = new ApiClient(
    'https://fixture.invalid',
    new MemoryVault(),
    transport,
  );
  await expect(
    new TruckRoutingService(api).calculate(origin, plan, truck),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(events()).toContainEqual(
    expect.objectContaining({ stage: 'BACKEND_HTTP', backendHttpStatus: 200 }),
  );
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'BACKEND_ERROR',
      reason: 'INVALID_RESPONSE',
    }),
  );
  expect(events().some(e => e.stage === 'RESPONSE_PARSE')).toBe(false);
  expect(JSON.stringify(events())).not.toContain('PRIVATE_PAYLOAD');
});
test('route observer is isolated from unrelated API paths and cannot break requests', async () => {
  const { api } = setup({ ok: true });
  const observer = jest.fn(() => {
    throw new Error('PRIVATE_OBSERVER_ERROR');
  });
  await expect(
    api.request('GET', '/trucks', undefined, undefined, true, observer),
  ).resolves.toEqual({ ok: true });
  expect(observer).not.toHaveBeenCalled();
  await expect(
    api.request('POST', '/routing/truck-route', {}, undefined, true, observer),
  ).resolves.toEqual({ ok: true });
  expect(observer).toHaveBeenCalledTimes(1);
});
test.each([
  'TRIMBLE_INVALID_RESPONSE',
  'TRIMBLE_ROUTE_GEOMETRY_INVALID',
  'TRIMBLE_MANEUVER_DATA_REQUIRED',
  'TRIMBLE_STOP_COVERAGE_UNPROVEN',
])('backend integrity reason %s remains explicit and blocked', async code => {
  const { service } = setup(
    { error: { code, message: 'PRIVATE_PROVIDER_PAYLOAD' } },
    502,
  );
  await expect(service.calculate(origin, plan, truck)).rejects.toMatchObject({
    code,
  });
  expect(events()).toContainEqual(
    expect.objectContaining({
      stage: 'DECISION',
      result: 'REJECTED',
      reason: code,
    }),
  );
  expect(events().some(e => e.result === 'ACCEPTED')).toBe(false);
});
