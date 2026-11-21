import {
  recordHybridFailure,
  hybridFailureSnapshot,
  clearHybridFailure,
} from '../src/services/copilot/HybridControlDiagnostics';
import {
  HybridControlError,
  hybridError,
} from '../src/services/copilot/HybridControls';
test('profile details are allowlisted, copied, and cleared only after the matching action succeeds', () => {
  recordHybridFailure('START_RESUME', {
    code: 'STANDARD_TRUCK_SCOPE',
    profileBlockers: [
      'AXLE_GROUP_WEIGHT_MISSING',
      'private account',
      { name: 'private' },
      'AXLE_GROUP_WEIGHT_MISSING',
    ],
    message: 'private truck',
  });
  const snapshot = hybridFailureSnapshot();
  expect(snapshot?.profileBlockers).toEqual(['AXLE_GROUP_WEIGHT_MISSING']);
  snapshot?.profileBlockers?.push('HEIGHT_UNSUPPORTED');
  expect(hybridFailureSnapshot()?.profileBlockers).toEqual([
    'AXLE_GROUP_WEIGHT_MISSING',
  ]);
  clearHybridFailure('TRUCK_SETTINGS');
  expect(hybridFailureSnapshot()).not.toBeNull();
  clearHybridFailure('START_RESUME');
  expect(hybridFailureSnapshot()).toBeNull();
});
test('retains fixed failure code without raw messages or profile data', () => {
  recordHybridFailure(
    'START_RESUME',
    new HybridControlError('private details', 'TRUCK_NOT_SELECTED'),
  );
  expect(hybridFailureSnapshot()).toEqual({
    action: 'START_RESUME',
    code: 'TRUCK_NOT_SELECTED',
  });
  recordHybridFailure('private action', {
    code: 'secret',
    message: 'private location',
  });
  expect(hybridFailureSnapshot()).toEqual({
    action: 'UNKNOWN_ACTION',
    code: 'UNCLASSIFIED_FAILURE',
  });
});

test('native geocoding still pending gives an actionable error without native details', () => {
  const message = hybridError({
    code: 'ENGINE_GEOCODE_BUSY',
    message: 'private coordinates',
  });
  expect(message).toContain('previous destination lookup');
  expect(message).not.toContain('private coordinates');
  recordHybridFailure('START_RESUME', { code: 'ENGINE_GEOCODE_BUSY' });
  expect(hybridFailureSnapshot()?.code).toBe('ENGINE_GEOCODE_BUSY');
});

test('unconfirmed resume explains recovery and keeps diagnostics sanitized', () => {
  const error = {
    code: 'ENGINE_ROUTE_UNCONFIRMED',
    message: 'private profile',
  };
  expect(hybridError(error)).toContain('End Route');
  expect(hybridError(error)).not.toContain('private profile');
  recordHybridFailure('START_RESUME', error);
  expect(hybridFailureSnapshot()?.code).toBe('ENGINE_ROUTE_UNCONFIRMED');
});
