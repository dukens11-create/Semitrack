import { recordHybridFailure, hybridFailureSnapshot } from '../src/services/copilot/HybridControlDiagnostics';
import { HybridControlError } from '../src/services/copilot/HybridControls';
test('retains fixed failure code without raw messages or profile data', () => {
  recordHybridFailure('START_RESUME', new HybridControlError('private details', 'TRUCK_NOT_SELECTED'));
  expect(hybridFailureSnapshot()).toEqual({ action: 'START_RESUME', code: 'TRUCK_NOT_SELECTED' });
  recordHybridFailure('private action', { code: 'secret', message: 'private location' });
  expect(hybridFailureSnapshot()).toEqual({ action: 'UNKNOWN_ACTION', code: 'UNCLASSIFIED_FAILURE' });
});
