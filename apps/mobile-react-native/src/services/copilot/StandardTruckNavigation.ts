import { type TruckProfileBlocker } from './TruckProfileBlockers';
import { isServerVerifiedTruck, truckSchema } from '../../models/contracts';
import {
  assessCopilotTruckProfile,
  feetToConservativeInches,
} from './CopilotTruckProfile';

export const standardTruckNotice =
  'Standard single 53-foot semitrailer only, with no hazardous cargo or oversize/overweight permit requirements. The engine must report one trailer and a 53-foot maximum straight length. Review its bumper-to-bumper length and routing weights against your vehicle and load. This limited mode does not support other truck configurations.';

export class StandardTruckValidationError extends Error {
  constructor(
    readonly profileBlockers: readonly TruckProfileBlocker[],
    problems: string[],
  ) {
    super(
      'Truck settings need review:\n\n' +
        problems.map(problem => '- ' + problem).join('\n') +
        '\n\nSaved settings have not been changed. Keep your actual vehicle specifications and any restrictions required for this trip.',
    );
  }
}

/** A limited existing CoPilot routing mode, not certification of 11.4 fields. */
export function standardTruckRequest(input: unknown) {
  // Reuse exhaustive field validation; never silently ignore a new restriction.
  assessCopilotTruckProfile(input);
  const t = truckSchema.parse(input);
  const problems: string[] = [];
  const blockers: TruckProfileBlocker[] = [];
  function problem(code: TruckProfileBlocker, message: string) {
    blockers.push(code);
    problems.push(message);
  }
  if (!isServerVerifiedTruck(t))
    problem('PROFILE_NOT_VERIFIED', 'Save and verify the selected truck');
  if (t.lengthFt !== 53)
    problem(
      'TRAILER_LENGTH_UNSUPPORTED',
      'Trailer length: this mode requires 53 feet',
    );
  if (t.trailerCount !== 1)
    problem(
      'TRAILER_COUNT_UNSUPPORTED',
      'Trailer count: this mode requires one trailer',
    );
  if (t.axleCount !== 5)
    problem(
      'AXLE_COUNT_UNSUPPORTED',
      'Axle count: this mode requires five axles',
    );
  if (!['dry van', 'reefer'].includes((t.trailerType ?? '').toLowerCase()))
    problem(
      'TRAILER_TYPE_UNSUPPORTED',
      'This mode supports a dry van or reefer',
    );
  if (
    !['sleeper', 'sleeper cab', 'day cab'].includes(
      (t.tractorType ?? '').toLowerCase(),
    )
  )
    problem('TRACTOR_TYPE_UNSUPPORTED', 'Select a day cab or sleeper tractor');
  if (t.heightFt < 5 || t.heightFt > 13.5)
    problem('HEIGHT_UNSUPPORTED', 'Height: supported range is 5 to 13.5 feet');
  if (t.widthFt < 5 || t.widthFt > 8.5)
    problem('WIDTH_UNSUPPORTED', 'Width: supported range is 5 to 8.5 feet');
  if (t.weightLbs < 1500 || t.weightLbs > 80000)
    problem(
      'GROSS_WEIGHT_UNSUPPORTED',
      'Maximum weight: supported range is 1,500 to 80,000 lb',
    );
  if (
    t.weightPerAxleLbs === null ||
    t.weightPerAxleLbs < 800 ||
    t.weightPerAxleLbs > 34000
  )
    problem(
      t.weightPerAxleLbs === null
        ? 'AXLE_GROUP_WEIGHT_MISSING'
        : 'AXLE_GROUP_WEIGHT_UNSUPPORTED',
      'Maximum axle-group weight: required range is 800 to 34,000 lb',
    );
  if (t.hazmatEnabled || t.hazardousGoods.length)
    problem(
      'HAZMAT_UNSUPPORTED',
      'Hazardous cargo is not supported in this mode',
    );
  if (t.avoidFerries)
    problem(
      'AVOID_FERRIES_UNSUPPORTED',
      'Avoid ferries is enabled but cannot be enforced in this mode',
    );
  if (t.avoidHighways)
    problem(
      'AVOID_HIGHWAYS_UNSUPPORTED',
      'Avoid highways is enabled but cannot be enforced in this mode',
    );
  if (t.avoidResidential)
    problem(
      'AVOID_RESIDENTIAL_UNSUPPORTED',
      'Avoid residential roads is enabled but cannot be enforced in this mode',
    );
  if (t.avoidDirtRoads)
    problem(
      'AVOID_DIRT_ROADS_UNSUPPORTED',
      'Avoid dirt roads is enabled but cannot be enforced in this mode',
    );
  if (problems.length)
    throw new StandardTruckValidationError(blockers, problems);
  return {
    mode: 'STANDARD_SINGLE_53' as const,
    heightInches: feetToConservativeInches(t.heightFt),
    widthInches: feetToConservativeInches(t.widthFt),
    lengthInches: 636,
    weightLbs: t.weightLbs,
    weightPerAxleLbs: t.weightPerAxleLbs!,
    trailerCount: 1,
    axleCount: 5,
    avoidTolls: t.avoidTolls,
  };
}
