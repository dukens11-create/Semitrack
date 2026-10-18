import type { Services } from '../../app/services';
import { coPilotHost, type CoPilotHost } from './CoPilotHost';
import { assessCopilotTruckProfile } from './CopilotTruckProfile';

export type HybridAction =
  | 'START_RESUME'
  | 'TRUCK_SETTINGS'
  | 'END_ROUTE'
  | 'BACK'
  | 'READINESS'
  | 'SYNC_PROFILE';
export type HybridStage =
  | 'PRESS'
  | 'VALIDATING'
  | 'NATIVE_CALL'
  | 'CONFIRMED'
  | 'FAILED'
  | 'BUSY';
export function logHybridControl(action: HybridAction, stage: HybridStage) {
  // Deliberately no locations, profile values, IDs, tokens or native exception text.
  console.info(JSON.stringify({ event: 'HYBRID_CONTROL', action, stage }));
  try {
    void coPilotHost()
      .recordHybridControl?.(action, stage)
      .catch(() => {});
  } catch {
    /* Bridge may be unavailable; never block the control. */
  }
}
export class HybridControlError extends Error {}
export function hybridError(error: unknown): string {
  if (error instanceof HybridControlError) return error.message;
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  switch (code) {
    case 'TRUCK_RESTRICTIONS_UNREPRESENTABLE':
      return 'Truck synchronization is blocked: this SDK cannot verify axle count and trailer configuration. Trimble must confirm a supported SDK/profile mapping. Saved truck details have not been removed.';
    case 'ENGINE_STOP_UNCONFIRMED':
      return 'The engine has not confirmed stopping. Keep this session open and retry End Route.';
    case 'ENGINE_TRIP_TIMEOUT':
      return 'The engine did not confirm the route in time. End Route before retrying, then check offline maps and GPS.';
    case 'ENGINE_TRIP_CANCELLED':
      return 'Navigation start was cancelled.';
    case 'ENGINE_TRIP_FAILED':
      return 'The truck route could not be confirmed. Check truck restrictions, offline maps and GPS, then retry.';
    default:
      return 'The engine could not confirm this action. Check navigation setup and GPS, then retry. Diagnostics include the action result.';
  }
}
export async function synchronizeHybridTruck(
  services: Services,
  host: CoPilotHost,
) {
  const truck = services.trucks.getSnapshot().selected;
  if (!truck)
    throw new HybridControlError(
      'Open Truck settings, save and verify the truck profile before starting.',
    );
  // Do not partially apply a profile: an unsupported required restriction blocks all changes.
  const assessment = assessCopilotTruckProfile(truck);
  if (!assessment.canApply)
    throw Object.assign(new Error(), {
      code: 'TRUCK_RESTRICTIONS_UNREPRESENTABLE',
    });
  if (!host.applyTruckProfile)
    throw new HybridControlError(
      'This APK does not contain the truck-profile bridge. Install the matching Hybrid build.',
    );
  await host.applyTruckProfile(truck);
}
export async function resumeHybridTrip(host: CoPilotHost) {
  if (!host.resumeEngineTrip)
    throw new HybridControlError(
      'This APK does not contain the native resume control.',
    );
  logHybridControl('START_RESUME', 'NATIVE_CALL');
  await host.resumeEngineTrip();
}
export async function endHybridTrip(host: CoPilotHost, services: Services) {
  if (!host.endEngineTrip)
    throw new HybridControlError(
      'This APK does not contain the native stop control.',
    );
  logHybridControl('END_ROUTE', 'NATIVE_CALL');
  await host.endEngineTrip();
  // Failed/timeout stops retain the planner/session for retry. Never clear before SDK confirmation.
  services.routes.clear();
}
