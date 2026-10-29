import {
  readFleetTruckProfiles,
  selectFleetTruckProfile,
} from '../src/services/copilot/FleetTruckProfiles';
import type { CoPilotHost } from '../src/services/copilot/CoPilotHost';

const profile = {
  ticket: 'native-review',
  name: 'Assigned truck',
  source: 'FLEET_PORTAL' as const,
  heightInches: 162,
  widthInches: 102,
  lengthInches: 636,
  weightLbs: 80000,
  weightPerAxleLbs: 34000,
  active: false,
  truckRestrictionsVerified: false as const,
};
function host(result: unknown) {
  return {
    readFleetTruckProfiles: jest.fn().mockResolvedValue(result),
    selectFleetTruckProfile: jest.fn().mockResolvedValue(result),
  } as unknown as CoPilotHost;
}
test('reads downloaded profiles without asserting full restriction verification', async () => {
  expect(await readFleetTruckProfiles(host([profile]))).toEqual([profile]);
  expect(await readFleetTruckProfiles(host([]))).toEqual([]);
});
test.each([
  { source: 'MANUAL' },
  { source: 'DEFAULT' },
  { truckRestrictionsVerified: true },
  { ticket: '' },
  { weightPerAxleLbs: 0 },
  { heightInches: -1 },
])('rejects invalid or untrusted fleet readback %j', async change => {
  await expect(
    readFleetTruckProfiles(host([{ ...profile, ...change }])),
  ).rejects.toThrow();
});
test('selects by native ticket only and confirms active values', async () => {
  const active = { ...profile, ticket: '', active: true };
  const native = host(active);
  expect(await selectFleetTruckProfile(native, profile)).toEqual(active);
  expect(native.selectFleetTruckProfile).toHaveBeenCalledWith('native-review');
});
test.each([
  { active: false },
  { name: 'Other truck' },
  { weightLbs: 10000 },
  { lengthInches: 400 },
])('rejects mismatched selection %j', async change => {
  await expect(
    selectFleetTruckProfile(
      host({ ...profile, active: true, ...change }),
      profile,
    ),
  ).rejects.toThrow();
});
test('older bridge fails without a substitute profile or navigation call', async () => {
  await expect(readFleetTruckProfiles({} as CoPilotHost)).rejects.toThrow(
    'FLEET_BRIDGE_UNAVAILABLE',
  );
  await expect(
    selectFleetTruckProfile({} as CoPilotHost, profile),
  ).rejects.toThrow('FLEET_BRIDGE_UNAVAILABLE');
});
