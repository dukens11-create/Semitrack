import {
  engineTripLocations,
  engineTripProfileSchema,
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
