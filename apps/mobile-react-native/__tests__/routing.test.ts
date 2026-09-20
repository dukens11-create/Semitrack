import { MAX_INTERMEDIATE_STOPS } from '../src/models/routeLimits';
import {
  parseTruckRoute,
  serializeTruck,
  truckSchema,
} from '../src/models/contracts';
import { acceptManeuver } from '../src/features/guidance/progress';
import {
  addStop,
  createStopPlan,
  removeStop,
  reorderStop,
  intermediateArrival,
} from '../src/features/stops/StopPlan';
import { TruckRoutingService } from '../src/services/routing/TruckRoutingService';
import { RouteStore } from '../src/features/routing/RouteStore';
import { ApiClient } from '../src/services/api/ApiClient';
import {
  MemoryVault,
  reply,
  truck,
  routeRaw,
  route,
  deferred,
} from './fixtures';
const destination = {
    id: 'destination',
    name: 'Delivery',
    lat: 40,
    lng: -100.02,
  },
  a = { id: 'a', name: 'Pickup A', lat: 40, lng: -100.01 },
  b = { id: 'b', name: 'Pickup B', lat: 40, lng: -100 };
const plan = addStop(addStop(createStopPlan(destination), a), b);
function responseFor(points: { lat: number; lng: number }[]) {
  const turns = points
    .slice(1)
    .map((_, i) => ({
      ...routeRaw.turnByTurn[0]!,
      step: i + 1,
      offset: i + 1,
    }));
  return {
    ...routeRaw,
    validatedStops: points,
    routeGeometry: points.map(p => [p.lng, p.lat]),
    turnByTurn: turns,
    legs: turns.map(m => ({
      distanceMiles: 1,
      durationSeconds: 60,
      geometry: [],
      maneuvers: [m],
    })),
  };
}
test('complete routing profile retains units, hazmat, trailer and restrictions', () => {
  const value = serializeTruck(truck, true);
  expect(value).toMatchObject({
    heightFt: 13.5,
    weightLbs: 80000,
    currentWeightLbs: 76000,
    weightPerAxleLbs: 17000,
    hazmatEnabled: true,
    hazardousGoods: ['flammable'],
    trailerCount: 1,
    trailerType: 'dry van',
    avoidResidential: true,
    avoidDirtRoads: true,
    avoidFerries: true,
  });
  expect(value).not.toHaveProperty('name');
  expect(value).not.toHaveProperty('id');
});
test('invalid truck weight and contradictory hazmat are rejected', () => {
  expect(() =>
    truckSchema.parse({ ...truck, currentWeightLbs: 90000 }),
  ).toThrow();
  expect(() => truckSchema.parse({ ...truck, hazardousGoods: [] })).toThrow();
});
test('geometry offsets are consumed unchanged; repeated vertices preserved', () => {
  expect(route().routeGeometry).toHaveLength(4);
  expect(route().turnByTurn[1]?.offset).toBe(3);
  expect(acceptManeuver(route(), 'test-route', 0, 3)).toBe(3);
  expect(() => acceptManeuver(route(), 'test-route', 0, 1)).toThrow();
});
test.each([
  { provider: 'Mapbox' },
  { truckSafe: false },
  { navigationAllowed: false },
  { turnByTurn: [{ ...routeRaw.turnByTurn[0], offset: 99 }] },
  {
    turnByTurn: [
      { ...routeRaw.turnByTurn[0], geometryMatchDistanceMeters: 251 },
    ],
  },
  { turnByTurn: [routeRaw.turnByTurn[1], routeRaw.turnByTurn[0]] },
])('rejects unsafe/unusable response %p', change =>
  expect(() => parseTruckRoute({ ...routeRaw, ...change })).toThrow(),
);
test('missing mapping is not replaced with maneuver-list index', () =>
  expect(() =>
    parseTruckRoute({
      ...routeRaw,
      turnByTurn: [{ step: 1, instruction: 'Turn', distanceMiles: 2 }],
    }),
  ).toThrow());
test('stale/backward maneuver events rejected', () => {
  expect(() => acceptManeuver(route(), 'old-route', 0, 3)).toThrow();
  expect(() => acceptManeuver(route(), 'test-route', 3, 0)).toThrow();
});
test('add/remove/reorder preserves final destination and original plan', () => {
  expect(reorderStop(plan, 1, 0).stops.map(s => s.id)).toEqual(['b', 'a']);
  expect(removeStop(plan, 'a').stops.map(s => s.id)).toEqual(['b']);
  expect(plan.stops.map(s => s.id)).toEqual(['a', 'b']);
  expect(plan.destination).toEqual(destination);
  expect(() => addStop(plan, destination)).toThrow();
});
test('only the next intermediate arrival can consume a stop', () => {
  expect(intermediateArrival(plan, 'a').stops.map(s => s.id)).toEqual(['b']);
  expect(() => intermediateArrival(plan, 'b')).toThrow();
});
test('one authoritative request contains every remaining stop and current origin', async () => {
  const transport = jest.fn(async () =>
    reply(responseFor([{ lat: 39, lng: -99 }, b, destination])),
  );
  const routing = new TruckRoutingService(
    new ApiClient('https://api.example.test', new MemoryVault(), transport),
  );
  await routing.calculate(
    { lat: 39, lng: -99 },
    intermediateArrival(plan, 'a'),
    truck,
  );
  const call = transport.mock.calls as unknown as [string, RequestInit][];
  expect(call).toHaveLength(1);
  expect(call[0]?.[0]).toBe('https://api.example.test/routing/truck-route');
  expect(JSON.parse(String(call[0]?.[1].body))).toMatchObject({
    origin: { lat: 39, lng: -99 },
    destination: { lat: 40, lng: -100.02 },
    viaStops: [{ lat: 40, lng: -100 }],
  });
});
test('Trimble/failed multi-stop leg never calls passenger routing or drops a stop', async () => {
  const transport = jest.fn(async () =>
    reply(
      { error: { code: 'TRIMBLE_ROUTE_FAILED', message: 'Leg unavailable' } },
      503,
    ),
  );
  const store = new RouteStore(
    new TruckRoutingService(
      new ApiClient('https://api.example.test', new MemoryVault(), transport),
    ),
  );
  expect(await store.calculate(a, plan, truck)).toBe(false);
  expect(store.getSnapshot().route).toBeNull();
  expect(store.getSnapshot().phase).toBe('error');
  expect(transport).toHaveBeenCalledTimes(1);
  const request = transport.mock.calls as unknown as [string, RequestInit][];
  expect(request[0]?.[0]).toMatch(/\/routing\/truck-route$/);
  expect(JSON.parse(String(request[0]?.[1].body)).viaStops).toHaveLength(2);
});
test('failed reroute keeps previous route and exact stop plan', async () => {
  const pending = deferred<Response>();
  const transport = jest
    .fn()
    .mockResolvedValueOnce(reply(responseFor([a, a, b, destination])))
    .mockImplementationOnce(() => pending.promise);
  const store = new RouteStore(
    new TruckRoutingService(
      new ApiClient('https://api.example.test', new MemoryVault(), transport),
    ),
  );
  await store.calculate(a, plan, truck);
  const recalculation = store.calculate(b, removeStop(plan, 'a'), truck);
  expect(store.getSnapshot().phase).toBe('rerouting');
  pending.resolve(reply({ error: { message: 'Failed leg' } }, 503));
  expect(await recalculation).toBe(false);
  expect(store.getSnapshot().plan).toBe(plan);
  expect(store.getSnapshot().route?.selectedRouteId).toBe('test-route');
  expect(store.getSnapshot().error).toBe(
    'SemiTraX is temporarily unavailable. Please try again later.',
  );
  expect(store.getSnapshot().error).not.toContain('Failed leg');
});
test('late response cannot replace the latest plan', async () => {
  const old = deferred<ReturnType<typeof route>>();
  const routing = {
    calculate: jest
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce(route()),
  } as unknown as TruckRoutingService;
  const store = new RouteStore(routing);
  const first = store.calculate(a, plan, truck);
  const next = removeStop(plan, 'a');
  await store.calculate(b, next, truck);
  old.resolve(route());
  expect(await first).toBe(false);
  expect(store.getSnapshot().plan).toBe(next);
});

test('alternative request preserves exact truck revision, canonical units and ordered stops', async () => {
  const request = jest.fn(async () => responseFor([a, a, b, destination]));
  const service = new TruckRoutingService({ request } as unknown as ApiClient);
  await service.calculate(a, plan, truck, undefined, 2);
  const payload = request.mock.calls as unknown as [
    string,
    string,
    Record<string, unknown>,
  ][];
  expect(payload[0]?.[2]).toMatchObject({
    alternatives: 2,
    truckProfileId: truck.id,
    truckRevision: truck.revision,
    viaStops: [
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
    ],
    truck: {
      heightFt: 13.5,
      widthFt: 8.5,
      lengthFt: 72,
      weightLbs: 80000,
      axleCount: 5,
      trailerCount: 1,
    },
  });
});
test('malformed stop lists and alternative counts fail before HTTP', async () => {
  const request = jest.fn();
  const service = new TruckRoutingService({ request } as unknown as ApiClient);
  for (const stops of [
    [a, a],
    [destination],
    Array.from({ length: MAX_INTERMEDIATE_STOPS + 1 }, (_, i) => ({
      ...a,
      id: String(i),
    })),
  ])
    await expect(
      service.calculate(a, { destination, stops }, truck),
    ).rejects.toThrow();
  for (const count of [-1, 1.5, 4])
    await expect(
      service.calculate(a, plan, truck, undefined, count),
    ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
test.each([401, 403])(
  'authorization failure %s discards old preview',
  async status => {
    const calculate = jest
      .fn()
      .mockResolvedValueOnce(route())
      .mockRejectedValueOnce({ status });
    const store = new RouteStore({
      calculate,
    } as unknown as TruckRoutingService);
    await store.calculate(a, plan, truck);
    await store.calculate(a, plan, truck);
    expect(store.getSnapshot().route).toBeNull();
  },
);
test('provider failure cannot retain a route belonging to another profile or revision', async () => {
  for (const next of [
    { ...truck, id: 'different' },
    { ...truck, revision: 2, verifiedRevision: 2 },
    { ...truck, heightFt: 14 },
  ]) {
    const calculate = jest
      .fn()
      .mockResolvedValueOnce(route())
      .mockRejectedValueOnce({ status: 503 });
    const store = new RouteStore({
      calculate,
    } as unknown as TruckRoutingService);
    await store.calculate(a, plan, truck);
    await store.calculate(a, plan, next);
    expect(store.getSnapshot().route).toBeNull();
    expect(store.getSnapshot().plan).toBeNull();
  }
});

test('invalid local truck data clears prior preview before any provider call', async () => {
  const calculate = jest.fn().mockResolvedValue(route());
  const invalidate = jest.fn();
  const store = new RouteStore(
    { calculate } as unknown as TruckRoutingService,
    invalidate,
  );
  await store.calculate(a, plan, truck);
  expect(await store.calculate(a, plan, { ...truck, heightFt: NaN })).toBe(
    false,
  );
  expect(store.getSnapshot().route).toBeNull();
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(calculate).toHaveBeenCalledTimes(1);
});

test('response must prove the same complete ordered stop plan', async () => {
  const expected = [a, a, b, destination],
    complete = responseFor(expected);
  const request = jest.fn();
  const service = new TruckRoutingService({ request } as unknown as ApiClient);
  request.mockResolvedValue(complete);
  await expect(service.calculate(a, plan, truck)).resolves.toBeDefined();
  for (const invalid of [
    { ...complete, validatedStops: undefined },
    { ...complete, legs: complete.legs.slice(1) },
    { ...complete, validatedStops: [a, b, a, destination] },
    { ...complete, validatedStops: [a, a, b, { lat: 41, lng: -101 }] },
  ]) {
    request.mockResolvedValue(invalid);
    await expect(service.calculate(a, plan, truck)).rejects.toThrow();
  }
});
