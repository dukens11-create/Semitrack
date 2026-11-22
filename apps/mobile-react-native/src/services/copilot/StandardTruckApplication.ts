import type { Services } from '../../app/services';
import type { CoPilotHost } from './CoPilotHost';
import { HybridControlError } from './HybridControls';
import {
  standardTruckRequest,
  StandardTruckValidationError,
} from './StandardTruckNavigation';

export function reviewStandardTruckApplication(
  services: Services,
  feet: string,
  inches: string,
  wholeVehicleConfirmed: boolean,
) {
  const selected = services.trucks.getSnapshot().selected;
  if (!selected)
    throw new HybridControlError(
      'Save and verify a truck first.',
      'TRUCK_NOT_SELECTED',
    );
  let request;
  try {
    request = standardTruckRequest(selected);
  } catch (error) {
    throw new HybridControlError(
      error instanceof StandardTruckValidationError
        ? error.message
        : 'Review the saved truck settings.',
      error instanceof StandardTruckValidationError
        ? 'STANDARD_TRUCK_SCOPE'
        : 'SAVED_TRUCK_INVALID',
      error instanceof StandardTruckValidationError
        ? error.profileBlockers
        : undefined,
    );
  }
  if (!wholeVehicleConfirmed)
    throw new HybridControlError(
      'Confirm that Total routing weight is for the tractor, trailer and load together, not cargo alone or an axle group.',
      'STANDARD_TRUCK_CONFIRMATION_REQUIRED',
    );
  const overall = Number(feet) * 12 + Number(inches);
  if (
    !/^\d+$/.test(feet) ||
    !/^\d+$/.test(inches) ||
    Number(inches) > 11 ||
    !Number.isSafeInteger(overall) ||
    overall <= request.lengthInches ||
    overall > 2147483647
  )
    throw new HybridControlError(
      'Enter the actual overall tractor-and-trailer length in whole feet and inches (0–11). It must exceed the trailer length; no default is supplied.',
      'OVERALL_LENGTH_REQUIRED',
    );
  return {
    fingerprint: JSON.stringify(selected),
    request: {
      ...request,
      bumperToBumperLengthInches: overall,
      confirmedWholeVehicleWeight: true as const,
    },
  };
}
export async function applyReviewedStandardTruck(
  services: Services,
  host: CoPilotHost,
  review: ReturnType<typeof reviewStandardTruckApplication>,
) {
  const unchanged = () =>
    JSON.stringify(services.trucks.getSnapshot().selected) ===
    review.fingerprint;
  if (!unchanged())
    throw new HybridControlError(
      'Your saved truck changed. Review it again before applying.',
      'STANDARD_TRUCK_RECHECK_REQUIRED',
    );
  if (!host.applyStandardTruckProfile || !host.verifyStandardTruckProfile)
    throw new HybridControlError(
      'Install the matching APK to apply the truck profile.',
      'PROFILE_BRIDGE_MISSING',
    );
  await host.applyStandardTruckProfile(review.request);
  if (!unchanged())
    throw new HybridControlError(
      'Your saved truck changed during application. Review and apply it again before starting.',
      'STANDARD_TRUCK_RECHECK_REQUIRED',
    );
  await host.verifyStandardTruckProfile(review.request);
  // This operation intentionally does not accept a profile or start/resume guidance.
}
