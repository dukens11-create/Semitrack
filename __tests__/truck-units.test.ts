import {
  parseTruckForm,
  dimensionForm,
  profileErrors,
  hazmatLabels,
} from '../src/features/truckProfile/form';
import {
  suggestedLengths,
  trailerTypes,
} from '../src/features/truckProfile/equipment';
import { serializeTruck } from '../src/models/contracts';
import { ApiError, ApiClient } from '../src/services/api/ApiClient';
import { truck } from './fixtures';
const form = {
  ...truck,
  tractorType: 'Sleeper Cab',
  trailerType: 'Dry Van',
  heightFt: '13',
  heightIn: '6',
  widthFt: '8',
  widthIn: '6',
  lengthFt: '53',
  lengthIn: '0',
};
test('13 feet 6 inches sends 13.5 API feet, never 162 API feet', () => {
  const payload = serializeTruck(parseTruckForm(form));
  expect(payload.heightFt).toBe(13.5);
  expect(payload).not.toHaveProperty('heightIn');
  expect(payload.widthFt).toBe(8.5);
  expect(payload.lengthFt).toBe(53);
});
test('decimal feet are accepted only without an additional inches fraction', () => {
  expect(
    parseTruckForm({ ...form, heightFt: '13.5', heightIn: '' }).heightFt,
  ).toBe(13.5);
  expect(() =>
    parseTruckForm({ ...form, heightFt: '13.5', heightIn: '6' }),
  ).toThrow();
});
test('custom dimensions preserve measured fractions and round-trip saved units', () => {
  const profile = parseTruckForm({
    ...form,
    heightFt: '12',
    heightIn: '7.5',
    widthFt: '8',
    widthIn: '2',
    lengthFt: '49',
    lengthIn: '3',
  });
  expect(profile.heightFt).toBe(12.625);
  expect(profile.widthFt).toBeCloseTo(8 + 2 / 12);
  expect(profile.lengthFt).toBe(49.25);
  const roundTrip = parseTruckForm({ ...profile, ...dimensionForm(profile) });
  expect(roundTrip.heightFt).toBe(profile.heightFt);
  expect(roundTrip.widthFt).toBeCloseTo(profile.widthFt, 8);
});
test.each([
  '162',
  '20',
  '21',
  '0',
  '-13',
  '13 ft 6 in',
  '13,6',
  '1e2',
  'Infinity',
  '',
])('invalid height %s is blocked before HTTP', heightFt => {
  expect(() => parseTruckForm({ ...form, heightFt })).toThrow();
});
test.each(['12', '-1', 'NaN', '12.5'])(
  'invalid inches %s are never silently carried or clamped',
  heightIn => {
    expect(() => parseTruckForm({ ...form, heightIn })).toThrow();
  },
);
test('routing limits stay enforced across dimensions, weights and integer counts', () => {
  for (const value of [
    { heightFt: '15', heightIn: '1' },
    { widthFt: '8', widthIn: '7' },
    { lengthFt: '70', lengthIn: '1' },
    { weightLbs: '156471' },
    { currentWeightLbs: '81000' },
    { weightPerAxleLbs: '45001' },
    { axleCount: '1' },
    { axleCount: '2.5' },
    { axleCount: '15' },
    { trailerCount: '5' },
    { trailerCount: '1.5' },
  ])
    expect(() => parseTruckForm({ ...form, ...value })).toThrow();
  const payload = serializeTruck(
    parseTruckForm({
      ...form,
      weightLbs: '80000',
      currentWeightLbs: '76000',
      weightPerAxleLbs: '34000',
      axleCount: '5',
      trailerCount: '1',
    }),
  );
  expect(payload).toMatchObject({
    weightLbs: 80000,
    currentWeightLbs: 76000,
    weightPerAxleLbs: 34000,
    axleCount: 5,
    trailerCount: 1,
  });
});
test('all equipment and nominal length options preserve units and unknown actual facts', () => {
  for (const trailerType of trailerTypes.filter(t => t !== 'Other / Custom')) {
    for (const length of [...suggestedLengths(trailerType), 53]) {
      const value = parseTruckForm({
        ...form,
        trailerType,
        lengthFt: String(length),
        lengthIn: '0',
        trailerCount: trailerType === 'No Trailer' ? '0' : '1',
      });
      expect(value.lengthFt).toBe(length);
      expect(value.heightFt).toBe(13.5);
      expect(value.widthFt).toBe(8.5);
    }
  }
});
test('server validation details become known field messages, never raw JSON', async () => {
  const transport = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'raw internal body',
            details: { fieldErrors: { heightFt: ['secret internal string'] } },
          },
        }),
        { status: 400 },
      ),
  );
  const client = new ApiClient(
    'https://api.example.test',
    { read: async () => null } as never,
    transport as never,
  );
  try {
    await client.request('POST', '/trucks', {});
    throw Error('Expected validation failure');
  } catch (error) {
    const display = profileErrors(error);
    expect(display.fields.heightFt).toContain('measured loaded height');
    expect(JSON.stringify(display)).not.toMatch(
      /raw internal|secret internal|too_big/,
    );
  }
});
test('hazmat labels and unexpected failures never leak internal identifiers', () => {
  expect(hazmatLabels.poisonousInhalation).toBe('Poisonous by inhalation');
  expect(hazmatLabels.harmfulToWater).toBe('Harmful to water');
  expect(
    JSON.stringify(profileErrors(new Error('SQL password stack trace'))),
  ).not.toContain('SQL');
  expect(
    profileErrors(
      new ApiError('VALIDATION_ERROR', 'raw', 400, false, ['currentWeightLbs']),
    ).fields.currentWeightLbs,
  ).toContain('whole pounds');
});
