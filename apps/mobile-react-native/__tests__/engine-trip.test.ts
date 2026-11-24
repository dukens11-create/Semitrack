import {
  engineTripLocations,
  engineTripProfileSchema,
  engineTripProfileSummary,
} from '../src/services/copilot/EngineTrip';
const origin = { lat: 39, lng: -119 };
const destination = {
  id: 'destination',
  name: 'Warehouse',
  lat: 40,
  lng: -120,
};
test('single destination still sends a separate GPS origin', () => {
  expect(engineTripLocations(origin, { destination, stops: [] })).toEqual([
    { ...origin, name: 'Current location' },
    { lat: 40, lng: -120, name: 'Warehouse' },
  ]);
});
test('invalid coordinates and duplicate stops cannot reach native trip creation', () => {
  expect(() =>
    engineTripLocations({ lat: NaN, lng: -119 }, { destination, stops: [] }),
  ).toThrow();
  expect(() =>
    engineTripLocations(origin, { destination, stops: [destination] }),
  ).toThrow();
});
test('engine profile review requires positive actual dimensions and a review ticket', () => {
  expect(
    engineTripProfileSchema.safeParse({
      name: 'Duke',
      heightInches: 0,
      widthInches: 102,
      lengthInches: 636,
      weightLbs: 80000,
    }).success,
  ).toBe(false);
});

const review = {
  ticket: 'test-review', name: 'Assigned standard truck',
  heightInches: 162, widthInches: 102, lengthInches: 636,
  weightLbs: 80000, weightPerAxleLbs: 34000, trailerCount: 1,
  maximumStraightLengthInches: 636, bumperToBumperLengthInches: 882,
};
test('review distinguishes engine routing limits and both length fields', () => {
  const text = engineTripProfileSummary(engineTripProfileSchema.parse(review));
  expect(text).toContain('Maximum straight length 53 ft 0 in');
  expect(text).toContain('Bumper-to-bumper length 73 ft 6 in');
  expect(text).toContain('Trailers 1');
  expect(text).toContain('Maximum axle-group routing weight 34,000 lb');
  expect(text).toContain('not measured load weights');
});
test.each([
  { trailerCount: undefined }, { trailerCount: 2 },
  { maximumStraightLengthInches: 600 },
  { bumperToBumperLengthInches: 0 },
  { weightPerAxleLbs: undefined },
])('incomplete or incompatible native readback cannot be confirmed: %j', change => {
  expect(engineTripProfileSchema.safeParse({ ...review, ...change }).success).toBe(false);
});
