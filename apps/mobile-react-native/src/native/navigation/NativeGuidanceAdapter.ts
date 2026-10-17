import NativePlatform from './NativeSemiTraxPlatform';
import type { TruckProfile } from '../../models/contracts';
import { requireRepresentableCopilotTruckProfile } from '../../services/copilot/CopilotTruckProfile';
import {
  UnavailableNavigationEngine,
  GuidanceUnavailableError,
} from '../../services/guidance/NavigationEngine';
/** Native transport boundary only. Activation requires a separately reviewed CoPilot adapter. */
export class NativeGuidanceAdapter extends UnavailableNavigationEngine {
  override async setTruckProfile(profile: TruckProfile) {
    // Surface every unrepresentable restriction before any future CPIK mutation.
    requireRepresentableCopilotTruckProfile(profile);
  }
  override async startNavigation() {
    if (NativePlatform) {
      await NativePlatform.guidanceCommand('startNavigation', '{}');
    }
    // Even an unexpected success from a misconfigured native module must not activate JS guidance.
    throw new GuidanceUnavailableError();
  }
}
