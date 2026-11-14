import { standardTruckRequest } from '../src/services/copilot/StandardTruckNavigation';
import { synchronizeHybridTruck } from '../src/services/copilot/HybridControls';
import type { Services } from '../src/app/services';
import type { CoPilotHost } from '../src/services/copilot/CoPilotHost';
import { truck } from './fixtures';
import {
  recordHybridFailure,
  hybridFailureSnapshot,
  clearHybridFailure,
} from '../src/services/copilot/HybridControlDiagnostics';

const standard = {
  ...truck,
  lengthFt: 53,
  weightPerAxleLbs: 34000,
  hazmatEnabled: false,
  hazardousGoods: [],
  avoidFerries: false,
  avoidResidential: false,
  avoidDirtRoads: false,
};

test('reproduces phone profile failure and retains each blocker without calling native code', async () => {
  const saved = {
    ...standard,
    axleCount: 3,
    trailerCount: 2,
    weightPerAxleLbs: null,
    avoidResidential: true,
    avoidDirtRoads: true,
  };
  const original = JSON.stringify(saved);
  const verifyStandardTruckProfile = jest.fn();
  const services = {
    trucks: { getSnapshot: () => ({ selected: saved }) },
  } as unknown as Services;
  try {
    await synchronizeHybridTruck(services, {
      verifyStandardTruckProfile,
    } as unknown as CoPilotHost);
    throw new Error('Expected profile rejection');
  } catch (error) {
    recordHybridFailure('START_RESUME', error);
    expect(hybridFailureSnapshot()).toEqual({
      action: 'START_RESUME',
      code: 'STANDARD_TRUCK_SCOPE',
      profileBlockers: [
        'TRAILER_COUNT_UNSUPPORTED',
        'AXLE_COUNT_UNSUPPORTED',
        'AXLE_GROUP_WEIGHT_MISSING',
        'AVOID_RESIDENTIAL_UNSUPPORTED',
        'AVOID_DIRT_ROADS_UNSUPPORTED',
      ],
    });
  }
  expect(verifyStandardTruckProfile).not.toHaveBeenCalled();
  expect(JSON.stringify(saved)).toBe(original);
  clearHybridFailure('START_RESUME');
});

test('corrected counts remove only their blockers; malformed input is not mislabeled as standard-truck scope', async () => {
  for (const [selected, expected] of [
    [
      {
        ...standard,
        weightPerAxleLbs: null,
        avoidResidential: true,
        avoidDirtRoads: true,
      },
      {
        code: 'STANDARD_TRUCK_SCOPE',
        profileBlockers: [
          'AXLE_GROUP_WEIGHT_MISSING',
          'AVOID_RESIDENTIAL_UNSUPPORTED',
          'AVOID_DIRT_ROADS_UNSUPPORTED',
        ],
      },
    ],
    [{ ...standard, axleCount: '5' }, { code: 'SAVED_TRUCK_INVALID' }],
    [
      { ...standard, unreviewedRestriction: true },
      { code: 'SAVED_TRUCK_INVALID' },
    ],
  ] as const) {
    const services = {
      trucks: { getSnapshot: () => ({ selected }) },
    } as unknown as Services;
    await expect(
      synchronizeHybridTruck(services, {} as CoPilotHost),
    ).rejects.toMatchObject(expected);
  }
});
test('standard truck produces native units and conservative maximum routing weight', () => {
  expect(standardTruckRequest(standard)).toEqual({
    mode: 'STANDARD_SINGLE_53',
    heightInches: 162,
    widthInches: 102,
    lengthInches: 636,
    weightLbs: 80000,
    weightPerAxleLbs: 34000,
    trailerCount: 1,
    axleCount: 5,
    avoidTolls: true,
  });
});
test.each([
  { trailerCount: 2 },
  { trailerCount: 0 },
  { axleCount: 6 },
  { lengthFt: 73.5 },
  { heightFt: 13.51 },
  { widthFt: 8.51 },
  { weightLbs: 80001 },
  { weightPerAxleLbs: null },
  { weightPerAxleLbs: 34001 },
  { trailerType: 'tanker' },
  { tractorType: 'Straight / Box Truck' },
  { hazmatEnabled: true, hazardousGoods: ['flammable'] },
  { avoidFerries: true },
  { avoidHighways: true },
  { avoidResidential: true },
  { avoidDirtRoads: true },
  { verificationState: 'ADMIN_UPDATED' },
  { verifiedRevision: 2 },
  { isDefault: false },
  { newRestriction: true },
  { overallLengthFt: 73.5 },
])('unsupported or unverified truck cannot enter this mode: %j', changes => {
  expect(() => standardTruckRequest({ ...standard, ...changes })).toThrow();
});
test('synchronization verifies readback without changing engine fields', async () => {
  const verifyStandardTruckProfile = jest.fn().mockResolvedValue(undefined);
  const applyTruckProfile = jest.fn();
  const services = {
    trucks: { getSnapshot: () => ({ selected: standard }) },
  } as unknown as Services;
  await synchronizeHybridTruck(services, {
    verifyStandardTruckProfile,
    applyTruckProfile,
  } as unknown as CoPilotHost);
  expect(verifyStandardTruckProfile).toHaveBeenCalledWith(
    standardTruckRequest(standard),
  );
  expect(applyTruckProfile).not.toHaveBeenCalled();
  verifyStandardTruckProfile.mockRejectedValue({
    code: 'TRUCK_DIMENSIONS_MISMATCH',
  });
  await expect(
    synchronizeHybridTruck(services, {
      verifyStandardTruckProfile,
    } as unknown as CoPilotHost),
  ).rejects.toEqual({ code: 'TRUCK_DIMENSIONS_MISMATCH' });
});
