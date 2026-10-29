import { isServerVerifiedTruck, truckSchema } from '../../models/contracts';
import {
  assessCopilotTruckProfile,
  feetToConservativeInches,
} from './CopilotTruckProfile';

export const standardTruckNotice =
  'Standard single 53-foot semitrailer only, with no hazardous cargo or oversize/overweight permit requirements. CoPilot 11.3 routes using trailer length; separate overall-length and trailer-count fields are not verified by this SDK. Do not use this mode when those additional controls are required.';

/** A limited existing CoPilot routing mode, not certification of 11.4 fields. */
export function standardTruckRequest(input: unknown) {
  // Reuse exhaustive field validation; never silently ignore a new restriction.
  assessCopilotTruckProfile(input);
  const t = truckSchema.parse(input);
  const problems: string[] = [];
  if (!isServerVerifiedTruck(t))
    problems.push('Save and verify the selected truck');
  if (t.lengthFt !== 53 || t.trailerCount !== 1 || t.axleCount !== 5)
    problems.push('This mode requires one 53-foot trailer and five axles');
  if (!['dry van', 'reefer'].includes((t.trailerType ?? '').toLowerCase()))
    problems.push('This mode supports a dry van or reefer');
  if (
    !['sleeper', 'sleeper cab', 'day cab'].includes(
      (t.tractorType ?? '').toLowerCase(),
    )
  )
    problems.push('Select a day cab or sleeper tractor');
  if (
    t.heightFt < 5 ||
    t.heightFt > 13.5 ||
    t.widthFt < 5 ||
    t.widthFt > 8.5 ||
    t.weightLbs < 1500 ||
    t.weightLbs > 80000
  )
    problems.push('Oversize or overweight configurations are not supported');
  if (
    t.weightPerAxleLbs === null ||
    t.weightPerAxleLbs < 800 ||
    t.weightPerAxleLbs > 34000
  )
    problems.push(
      'Enter a maximum axle-group weight no greater than 34,000 lb',
    );
  if (t.hazmatEnabled || t.hazardousGoods.length)
    problems.push('Hazardous cargo is not supported in this mode');
  if (
    t.avoidFerries ||
    t.avoidHighways ||
    t.avoidResidential ||
    t.avoidDirtRoads
  )
    problems.push(
      'Strict ferry, highway, residential or dirt-road avoidance is not supported in this mode',
    );
  if (problems.length)
    throw new Error(
      problems.join('. ') + '. Saved settings have not been changed.',
    );
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
