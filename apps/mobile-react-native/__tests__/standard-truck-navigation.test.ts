import { standardTruckRequest } from '../src/services/copilot/StandardTruckNavigation';
import { synchronizeHybridTruck } from '../src/services/copilot/HybridControls';
import type { Services } from '../src/app/services';
import type { CoPilotHost } from '../src/services/copilot/CoPilotHost';
import { truck } from './fixtures';

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
