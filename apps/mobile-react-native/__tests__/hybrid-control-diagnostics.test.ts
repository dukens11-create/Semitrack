import { recordHybridFailure, hybridFailureSnapshot } from '../src/services/copilot/HybridControlDiagnostics';
import { HybridControlError, hybridError } from '../src/services/copilot/HybridControls';
test('retains fixed failure code without raw messages or profile data', () => {
  recordHybridFailure('START_RESUME', new HybridControlError('private details', 'TRUCK_NOT_SELECTED'));
  expect(hybridFailureSnapshot()).toEqual({ action: 'START_RESUME', code: 'TRUCK_NOT_SELECTED' });
  recordHybridFailure('private action', { code: 'secret', message: 'private location' });
  expect(hybridFailureSnapshot()).toEqual({ action: 'UNKNOWN_ACTION', code: 'UNCLASSIFIED_FAILURE' });
});

test('native geocoding still pending gives an actionable error without native details', () => {
  const message = hybridError({ code: 'ENGINE_GEOCODE_BUSY', message: 'private coordinates' });
  expect(message).toContain('previous destination lookup');
  expect(message).not.toContain('private coordinates');
  recordHybridFailure('START_RESUME', { code: 'ENGINE_GEOCODE_BUSY' });
  expect(hybridFailureSnapshot()?.code).toBe('ENGINE_GEOCODE_BUSY');
});
