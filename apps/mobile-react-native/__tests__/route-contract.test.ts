import { parseTruckRoute } from '../src/models/contracts';
import { safeDriverError, DriverError } from '../src/errors/driverErrors';
import { route } from './fixtures';
// Synthetic contract fixtures: no claim that these are a captured production response.
const maneuver = {
  step: 1,
  instruction: 'Continue on the road',
  distanceMiles: 0.1,
  durationSeconds: 30,
  offset: 0,
  geometryMatchDistanceMeters: 0,
  coordinate: { lat: 40, lng: -120 },
};
const input = {
  ...route(),
  routeGeometry: [
    [-120, 40],
    [-119.999, 40],
    [-119.998, 40],
  ],
  turnByTurn: [
    maneuver,
    {
      ...maneuver,
      step: 2,
      offset: 1,
      instruction: 'Turn right',
      geometryMatchDistanceMeters: 2,
    },
    {
      ...maneuver,
      step: 3,
      offset: 2,
      instruction: 'Arrive',
      action: 'arrive',
    },
  ],
};
test('first, intermediate and arrival mappings parse without losing measured geometry confidence', () => {
  const result = parseTruckRoute(input);
  expect(result.turnByTurn.map(m => m.offset)).toEqual([0, 1, 2]);
  expect(result.turnByTurn[1]!.geometryMatchDistanceMeters).toBe(2);
});
test.each(['offset', 'geometryMatchDistanceMeters'])(
  'missing %s fails closed rather than defaulting to zero',
  key => {
    for (let i = 0; i < 3; i++) {
      const copy = JSON.parse(JSON.stringify(input));
      delete copy.turnByTurn[i][key];
      expect(() => parseTruckRoute(copy)).toThrow(DriverError);
    }
  },
);
test('malformed or out-of-sequence maneuver mapping cannot enable route progress', () => {
  for (const patch of [
    { offset: 99 },
    { offset: -1 },
    { offset: '1' },
    { geometryMatchDistanceMeters: 251 },
    { geometryMatchDistanceMeters: NaN },
    { instruction: null },
  ])
    expect(() =>
      parseTruckRoute({ ...input, turnByTurn: [{ ...maneuver, ...patch }] }),
    ).toThrow(DriverError);
  expect(() =>
    parseTruckRoute({
      ...input,
      turnByTurn: [
        { ...maneuver, offset: 2 },
        { ...maneuver, offset: 1 },
      ],
    }),
  ).toThrow(DriverError);
});
test('validation failures and raw responses never become driver-facing error text', () => {
  for (const error of [
    new Error('[{"code":"too_big","path":["heightFt"]}]'),
    new Error('SQL password stack trace'),
    { code: 'VALIDATION_ERROR', message: 'secret details' },
    { code: 'UNKNOWN', message: 'raw server body' },
  ]) {
    expect(safeDriverError(error)).not.toMatch(
      /too_big|heightFt|SQL|password|secret|raw server|stack/,
    );
  }
  try {
    parseTruckRoute({ ...input, turnByTurn: [{}] });
  } catch (error) {
    expect(safeDriverError(error)).toBe(
      'Unable to prepare this truck route. Please try again or choose another destination.',
    );
  }
});


test('maneuver step ordering is enforced independently of geometry offsets', () => {
  for (const step of [1,0]) expect(() => parseTruckRoute({...input,
    turnByTurn:[input.turnByTurn[0],{...input.turnByTurn[1],step}]})).toThrow(DriverError);
});
test('alternative previews cannot duplicate route identities or smuggle mismatched legs', () => {
  const alternative = {id:'alt',distanceMiles:1,durationSeconds:60,etaMinutes:1,routeGeometry:input.routeGeometry,
    legs:[],turnByTurn:[],notices:[{code:'TRIMBLE_ALTERNATE_PREVIEW'}]};
  expect(parseTruckRoute({...input,alternatives:[alternative]}).alternatives[0]?.turnByTurn).toEqual([]);
  for (const alternatives of [[alternative,alternative],[{...alternative,id:input.selectedRouteId}],
    [{...alternative,legs:[{distanceMiles:1,durationSeconds:60,geometry:[],maneuvers:[maneuver]}]}],
    [{...alternative,notices:[]}], [{...alternative,routeGeometry:[[181,40],[0,40]]}]])
    expect(()=>parseTruckRoute({...input,alternatives})).toThrow(DriverError);
});
