import {
  reviewStandardTruckApplication,
  applyReviewedStandardTruck,
} from '../src/services/copilot/StandardTruckApplication';
import type { Services } from '../src/app/services';
import type { CoPilotHost } from '../src/services/copilot/CoPilotHost';
import { truck } from './fixtures';
const standard = {
  ...truck,
  lengthFt: 53,
  weightLbs: 34000,
  currentWeightLbs: null,
  weightPerAxleLbs: null,
  hazmatEnabled: false,
  hazardousGoods: [],
  avoidFerries: false,
  avoidHighways: false,
  avoidResidential: false,
  avoidDirtRoads: false,
};
let selected = { ...standard };
const services = {
  trucks: { getSnapshot: () => ({ selected }) },
} as unknown as Services;
beforeEach(() => {
  selected = { ...standard };
});
test('whole-vehicle and axle-group values stay separate; overall length is explicit', async () => {
  const original = JSON.stringify(selected);
  const review = reviewStandardTruckApplication(services, '73', '6', true);
  expect(review.request).toMatchObject({
    weightLbs: 34000,
    weightPerAxleLbs: 34000,
    lengthInches: 636,
    bumperToBumperLengthInches: 882,
  });
  const applyStandardTruckProfile = jest.fn().mockResolvedValue(undefined);
  const verifyStandardTruckProfile = jest.fn().mockResolvedValue(undefined);
  const acceptStandardTruckMode = jest.fn();
  const resumeEngineTrip = jest.fn();
  await applyReviewedStandardTruck(
    services,
    {
      applyStandardTruckProfile,
      verifyStandardTruckProfile,
      acceptStandardTruckMode,
      resumeEngineTrip,
    } as unknown as CoPilotHost,
    review,
  );
  expect(applyStandardTruckProfile).toHaveBeenCalledWith(review.request);
  expect(verifyStandardTruckProfile).toHaveBeenCalledWith(review.request);
  expect(acceptStandardTruckMode).not.toHaveBeenCalled();
  expect(resumeEngineTrip).not.toHaveBeenCalled();
  expect(JSON.stringify(selected)).toBe(original);
});
test.each([
  ['', '0'],
  ['53', '0'],
  ['52', '11'],
  ['73', '12'],
  ['73.5', '0'],
  ['-73', '0'],
  ['1e2', '0'],
])(
  'rejects missing, guessed or malformed overall length: %s %s',
  (feet, inches) => {
    expect(() =>
      reviewStandardTruckApplication(services, feet, inches, true),
    ).toThrow('actual overall');
  },
);
test('requires explicit whole-vehicle acknowledgement and preserves restriction gates', () => {
  expect(() =>
    reviewStandardTruckApplication(services, '73', '6', false),
  ).toThrow('Total routing weight');
  selected.avoidResidential = true;
  expect(() =>
    reviewStandardTruckApplication(services, '73', '6', true),
  ).toThrow('residential');
});
test('stale review cannot write to native; a change during application cannot verify or start', async () => {
  const review = reviewStandardTruckApplication(services, '73', '6', true);
  const applyStandardTruckProfile = jest.fn().mockResolvedValue(undefined);
  const verifyStandardTruckProfile = jest.fn();
  const host = {
    applyStandardTruckProfile,
    verifyStandardTruckProfile,
  } as unknown as CoPilotHost;
  selected.weightLbs = 60000;
  await expect(
    applyReviewedStandardTruck(services, host, review),
  ).rejects.toThrow('changed');
  expect(applyStandardTruckProfile).not.toHaveBeenCalled();
  selected.weightLbs = 34000;
  applyStandardTruckProfile.mockImplementation(async () => {
    selected.weightLbs = 60000;
  });
  await expect(
    applyReviewedStandardTruck(services, host, review),
  ).rejects.toThrow('changed');
  expect(verifyStandardTruckProfile).not.toHaveBeenCalled();
});
test('native rejection never becomes success', async () => {
  const review = reviewStandardTruckApplication(services, '73', '6', true);
  const verifyStandardTruckProfile = jest.fn();
  const host = {
    applyStandardTruckProfile: jest
      .fn()
      .mockRejectedValue({ code: 'PROFILE_APPLY_UNCONFIRMED' }),
    verifyStandardTruckProfile,
  } as unknown as CoPilotHost;
  await expect(
    applyReviewedStandardTruck(services, host, review),
  ).rejects.toMatchObject({ code: 'PROFILE_APPLY_UNCONFIRMED' });
  expect(verifyStandardTruckProfile).not.toHaveBeenCalled();
});
