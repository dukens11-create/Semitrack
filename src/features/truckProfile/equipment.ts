import { truckSchema, type TruckProfile } from '../../models/contracts';

// Body names describe equipment. The existing API routes these as commercial trucks.
export const tractorTypes = [
  'Day Cab',
  'Sleeper Cab',
  'Straight / Box Truck',
  'Dump Truck',
  'Other / Custom',
];
export const trailerTypes = [
  'Dry Van',
  'Reefer',
  'Flatbed',
  'Step Deck',
  'Lowboy',
  'Double Drop',
  'Tanker',
  'Car Hauler',
  'Container/Chassis',
  'Dump Trailer',
  'No Trailer',
  'Other / Custom',
];
// Validated nominal lengths only; no assumed height, width, weight or axles.
// Sources and mapping: docs/truck-profile-configuration.md.
export const lengthChoices: Record<string, readonly number[]> = {
  'Dry Van': [28, 48, 53],
  Reefer: [28, 36, 48, 53],
  Flatbed: [28, 45, 48, 53],
};
export function suggestedLengths(type: unknown): readonly number[] {
  const key = Object.keys(lengthChoices).find(
    item => item.toLowerCase() === String(type ?? '').toLowerCase(),
  );
  return key ? lengthChoices[key]! : [];
}
export function verifyRoutingProfile(value: unknown): TruckProfile {
  const truck = truckSchema.parse(value);
  const ranges: [string, number | null, number, number][] = [
    ['Height (ft)', truck.heightFt, 5, 15],
    ['Width (ft)', truck.widthFt, 5, 8.5],
    ['Length (ft)', truck.lengthFt, 8, 70],
    ['Gross weight (lb)', truck.weightLbs, 1500, 156470],
    [
      'Weight per axle / maximum axle group (lb)',
      truck.weightPerAxleLbs,
      800,
      45000,
    ],
    ['Axles', truck.axleCount, 2, 14],
  ];
  for (const [label, number, min, max] of ranges) {
    if (number !== null && (number < min || number > max))
      throw new Error(
        label +
          ' must be between ' +
          min +
          ' and ' +
          max +
          ' for the current Trimble routing service. Do not lower actual measurements to fit.',
      );
  }
  if (!truck.tractorType?.trim() || !truck.trailerType?.trim())
    throw new Error(
      'Choose or enter both equipment types. Use No Trailer when appropriate.',
    );
  if (
    truck.tractorType.length > 80 ||
    truck.trailerType.length > 80 ||
    (truck.unitNumber?.length ?? 0) > 40 ||
    (truck.trailerNumber?.length ?? 0) > 40
  )
    throw new Error(
      'Equipment types allow 80 characters; unit and trailer numbers allow 40.',
    );
  const noTrailer = truck.trailerType.trim().toLowerCase() === 'no trailer';
  if (noTrailer !== (truck.trailerCount === 0))
    throw new Error(
      'No Trailer requires 0 trailers. A trailer type requires at least 1 trailer.',
    );
  // Existing backend substring handling would otherwise select Caravan.
  if (/caravan|rv/i.test(truck.trailerType))
    throw new Error(
      'This trailer description maps to a recreational trailer in the current API. Enter an accurate commercial trailer description without RV or caravan.',
    );
  return truck;
}
export function profileFingerprint(profile: TruckProfile): string {
  const { createOperationId: _operation, isDefault: _default, verifiedRevision: _verifiedRevision, verifiedAt: _verifiedAt, verificationState: _state, ...values } = truckSchema.parse(profile);
  return JSON.stringify(values);
}
export function duplicateProfile(profile: TruckProfile): TruckProfile {
  return {
    ...profile,
    id: '',
    createOperationId: undefined,
    revision: undefined, verifiedRevision: undefined, verifiedAt: undefined, verificationState: undefined,
    name: profile.name.slice(0, 73) + ' (copy)',
    isDefault: false,
    hazardousGoods: [...profile.hazardousGoods],
  };
}
