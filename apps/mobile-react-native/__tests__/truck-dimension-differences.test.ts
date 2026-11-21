import { hybridError } from '../src/services/copilot/HybridControls';
import {
  recordHybridFailure,
  hybridFailureSnapshot,
} from '../src/services/copilot/HybridControlDiagnostics';
import { truckDimensionDifferences } from '../src/services/copilot/TruckDimensionDifferences';
const error = {
  code: 'TRUCK_DIMENSIONS_MISMATCH',
  message: 'private native exception',
  userInfo: {
    profileName: 'private profile',
    dimensionMismatches: [
      {
        field: 'heightInches',
        expected: 162,
        actual: 160,
        comparison: 'equal',
      },
      {
        field: 'bumperToBumperLengthInches',
        expected: 636,
        actual: 0,
        comparison: 'minimum',
      },
      {
        field: 'axleGroupWeightLbs',
        expected: 34000,
        actual: null,
        comparison: 'equal',
      },
    ],
  },
};
test('shows all differences, units, missing values and minimum versus equality', () => {
  const message = hybridError(error);
  expect(message).toContain('Height: required 162 in; CoPilot 160 in');
  expect(message).toContain(
    'Bumper-to-bumper length: required at least 636 in; CoPilot 0 in',
  );
  expect(message).toContain(
    'Axle-group routing weight: required 34000 lb; CoPilot not reported',
  );
  expect(message).not.toContain('private');
});
test('shared report contains only allowlisted numeric differences and defensive copies', () => {
  recordHybridFailure('START_RESUME', error);
  const first = hybridFailureSnapshot();
  expect(first?.dimensionMismatches).toHaveLength(3);
  first!.dimensionMismatches![0]!.actual = 999;
  expect(hybridFailureSnapshot()?.dimensionMismatches?.[0]?.actual).toBe(160);
  expect(JSON.stringify(first)).not.toContain('private');
  recordHybridFailure('START_RESUME', { code: 'ENGINE_TRIP_FAILED' });
  expect(hybridFailureSnapshot()?.dimensionMismatches).toBeUndefined();
});
test('rejects unknown fields, raw strings, nonfinite values and wrong comparison', () => {
  const rows = [
    { field: 'accountId', expected: 1, actual: 2, comparison: 'equal' },
    {
      field: 'heightInches',
      expected: 162,
      actual: 'secret',
      comparison: 'equal',
    },
    { field: 'widthInches', expected: 102, actual: NaN, comparison: 'equal' },
    {
      field: 'lengthInches',
      expected: 636,
      actual: 600,
      comparison: 'minimum',
    },
  ];
  expect(
    truckDimensionDifferences({
      ...error,
      userInfo: { dimensionMismatches: rows },
    }),
  ).toEqual([]);
  expect(
    truckDimensionDifferences({ ...error, code: 'ENGINE_TRIP_FAILED' }),
  ).toEqual([]);
  expect(hybridError({ code: error.code })).toContain('Review both profiles');
});
