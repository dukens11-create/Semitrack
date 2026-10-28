import { truckSchema, type TruckProfile } from '../../models/contracts';
import { CopilotP0Error } from './CopilotConfiguration';

type Classification =
  | 'SUPPORTED DIRECTLY'
  | 'SUPPORTED WITH CONVERSION'
  | 'NOT SUPPORTED'
  | 'REQUIRES TRIMBLE CONFIRMATION';
type FieldRule = {
  classification: Classification;
  target: string;
  routing: boolean;
};
const metadata: FieldRule = {
  classification: 'NOT SUPPORTED',
  target: 'Retained in SemiTraX metadata',
  routing: false,
};
const direct = (target: string): FieldRule => ({
  classification: 'SUPPORTED DIRECTLY',
  target,
  routing: true,
});
const convert = (target: string): FieldRule => ({
  classification: 'SUPPORTED WITH CONVERSION',
  target,
  routing: true,
});
const unsupported = (target: string): FieldRule => ({
  classification: 'NOT SUPPORTED',
  target,
  routing: true,
});
const confirm = (target: string): FieldRule => ({
  classification: 'REQUIRES TRIMBLE CONFIRMATION',
  target,
  routing: true,
});

// Exhaustive at compile time: adding a model field requires a mapping decision.
export const copilotTruckFieldMatrix: Record<keyof TruckProfile, FieldRule> = {
  id: metadata,
  createOperationId: metadata,
  revision: metadata,
  verifiedRevision: metadata,
  verifiedAt: metadata,
  verificationState: metadata,
  name: direct('VehicleRoutingProfile.name'),
  isDefault: metadata,
  heightFt: convert('dims.height: feet -> inches, rounded upward'),
  widthFt: convert('dims.width: feet -> inches, rounded upward'),
  lengthFt: convert('dims.length: feet -> inches, rounded upward'),
  weightLbs: direct('dims.totalWeight: pounds'),
  currentWeightLbs: confirm(
    'One native totalWeight; gross/loaded policy must be reviewed',
  ),
  weightPerAxleLbs: direct('dims.weightPerAxle: pounds; not a per-axle array'),
  // CoPilot 10.19 release notes: axle count is not used by CoPilot routing.
  // Keep fleet/toll metadata separate from the supported weight-per-axle input.
  axleCount: metadata,
  tractorType: metadata,
  trailerType: unsupported(
    'No trailer type field in the inspected profile API',
  ),
  trailerCount: unsupported(
    'No trailer count field; deprecated 53-foot flag is not equivalent',
  ),
  unitNumber: metadata,
  trailerNumber: metadata,
  hazmatEnabled: convert(
    'False -> HazmatType.NONE; true requires representable classes',
  ),
  hazardousGoods: confirm(
    'Single native hazmatType; multi-class and unmatched categories blocked',
  ),
  avoidTolls: convert('TollRoads.ALWAYS_AVOID / NO_RESTRICTION'),
  avoidFerries: confirm(
    'ferriesDiscouraged is not a verified strict ferry prohibition',
  ),
  avoidHighways: unsupported('No corresponding RN profile field'),
  avoidResidential: unsupported('No corresponding RN profile field'),
  avoidDirtRoads: unsupported('No corresponding RN profile field'),
};

export function feetToConservativeInches(feet: number): number {
  if (!Number.isFinite(feet) || feet <= 0) {
    throw new CopilotP0Error('INVALID_DIMENSION');
  }
  const inches = Math.ceil(feet * 12);
  if (!Number.isSafeInteger(inches)) {
    throw new CopilotP0Error('INVALID_DIMENSION');
  }
  return inches;
}

/** Partial conversion evidence only. This is deliberately NOT a CPIK payload. */
export function assessCopilotTruckProfile(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw new CopilotP0Error('TRUCK_PROFILE_INVALID');
  }
  const unknownFields = Object.keys(input).filter(
    field => !Object.hasOwn(copilotTruckFieldMatrix, field),
  );
  const parsed = truckSchema.safeParse(input);
  if (!parsed.success || unknownFields.length) {
    throw new CopilotP0Error('TRUCK_PROFILE_INVALID', unknownFields);
  }
  const truck = parsed.data;
  // Trailer/length semantics still need a verified mapping. Axle count remains
  // metadata and must not be confused with the required weight-per-axle input.
  const blockers: (keyof TruckProfile)[] = ['trailerCount'];
  if (truck.trailerType) {
    blockers.push('trailerType');
  }
  if (truck.currentWeightLbs !== null) {
    blockers.push('currentWeightLbs');
  }
  if (truck.weightPerAxleLbs === null) {
    blockers.push('weightPerAxleLbs');
  }
  for (const field of [
    'avoidFerries',
    'avoidHighways',
    'avoidResidential',
    'avoidDirtRoads',
  ] as const) {
    if (truck[field]) {
      blockers.push(field);
    }
  }
  const matchedHazmat: Partial<
    Record<TruckProfile['hazardousGoods'][number], string>
  > = {
    explosive: 'EXPLOSIVE',
    flammable: 'FLAMMABLE',
    radioactive: 'RADIOACTIVE',
    poisonousInhalation: 'INHALANT',
    harmfulToWater: 'HARMFUL_TO_WATER',
  };
  const firstClass = truck.hazardousGoods[0];
  const hazmatConstantName = !truck.hazmatEnabled
    ? 'NONE'
    : truck.hazardousGoods.length === 1 && firstClass
    ? matchedHazmat[firstClass]
    : undefined;
  if (!hazmatConstantName) {
    blockers.push('hazardousGoods');
  }
  return {
    canApply: false as const,
    blockers,
    conversionEvidence: {
      heightInches: feetToConservativeInches(truck.heightFt),
      widthInches: feetToConservativeInches(truck.widthFt),
      lengthInches: feetToConservativeInches(truck.lengthFt),
      grossWeightPounds: truck.weightLbs,
      weightPerAxlePounds: truck.weightPerAxleLbs,
      vehicleTypeConstantName: 'TRUCK_HEAVY_DUTY',
      hazmatConstantName,
      tollRoadsConstantName: truck.avoidTolls
        ? 'ALWAYS_AVOID'
        : 'NO_RESTRICTION',
    },
  };
}

export function requireRepresentableCopilotTruckProfile(
  profile: TruckProfile,
): never {
  const assessment = assessCopilotTruckProfile(profile);
  throw new CopilotP0Error(
    'TRUCK_RESTRICTIONS_UNREPRESENTABLE',
    assessment.blockers,
  );
}
