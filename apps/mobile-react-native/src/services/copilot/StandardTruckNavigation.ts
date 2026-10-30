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
  if (t.lengthFt !== 53)
    problems.push('Trailer length: this mode requires 53 feet');
  if (t.trailerCount !== 1)
    problems.push('Trailer count: this mode requires one trailer');
  if (t.axleCount !== 5)
    problems.push('Axle count: this mode requires five axles');
  if (!['dry van', 'reefer'].includes((t.trailerType ?? '').toLowerCase()))
    problems.push('This mode supports a dry van or reefer');
  if (
    !['sleeper', 'sleeper cab', 'day cab'].includes(
      (t.tractorType ?? '').toLowerCase(),
    )
  )
    problems.push('Select a day cab or sleeper tractor');
  if (t.heightFt < 5 || t.heightFt > 13.5)
    problems.push('Height: supported range is 5 to 13.5 feet');
  if (t.widthFt < 5 || t.widthFt > 8.5)
    problems.push('Width: supported range is 5 to 8.5 feet');
  if (t.weightLbs < 1500 || t.weightLbs > 80000)
    problems.push('Maximum weight: supported range is 1,500 to 80,000 lb');
  if (
    t.weightPerAxleLbs === null ||
    t.weightPerAxleLbs < 800 ||
    t.weightPerAxleLbs > 34000
  )
    problems.push(
      'Maximum axle-group weight: required range is 800 to 34,000 lb',
    );
  if (t.hazmatEnabled || t.hazardousGoods.length)
    problems.push('Hazardous cargo is not supported in this mode');
  if (t.avoidFerries)
    problems.push('Avoid ferries is enabled but cannot be enforced in this mode');
  if (t.avoidHighways)
    problems.push('Avoid highways is enabled but cannot be enforced in this mode');
  if (t.avoidResidential)
    problems.push(
      'Avoid residential roads is enabled but cannot be enforced in this mode',
    );
  if (t.avoidDirtRoads)
    problems.push(
      'Avoid dirt roads is enabled but cannot be enforced in this mode',
    );
  if (problems.length)
    throw new Error(
      'Truck settings need review:\n\n' +
        problems.map(problem => '- ' + problem).join('\n') +
        '\n\nSaved settings have not been changed. Keep your actual vehicle specifications and any restrictions required for this trip.',
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
