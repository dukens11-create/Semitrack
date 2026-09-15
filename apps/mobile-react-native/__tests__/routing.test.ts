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
  const transport = jest.fn(async () => reply(routeRaw));
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
    .mockResolvedValueOnce(reply(routeRaw))
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
