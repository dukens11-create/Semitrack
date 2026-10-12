import {
  amsSetupExplanation,
  retryAmsFailure,
} from '../src/services/copilot/CopilotLicenseDiagnostics';
test('Device ID setup failure stays distinct from rejected credentials and does not loop retries', () => {
  expect(amsSetupExplanation('license-verification: COPILOT_AMS_DEVICE_CONFIGURATION_FAILED')).toContain('Device ID setting');
  expect(amsSetupExplanation('license-verification: COPILOT_AMS_DEVICE_CONFIGURATION_FAILED')).not.toContain('Trimble rejected');
  expect(retryAmsFailure('COPILOT_AMS_DEVICE_CONFIGURATION_FAILED')).toBe(false);
});
test('unknown SDK text never enters the user explanation', () => {
  expect(
    amsSetupExplanation('license-verification: unit-secret-canary'),
  ).toBeNull();
});
test('missing identity is not represented as a license rejection', () => {
  expect(
    amsSetupExplanation('license-verification: COPILOT_AMS_IDENTITY_MISSING'),
  ).toContain('login is not confirmed');
});
test('actual server response distinguishes network failure from invalid assignment', () => {
  expect(
    amsSetupExplanation(
      'license-verification: COPILOT_AMS_LOGIN_FAILED_LOGIN_CANT_REACH_SERVER',
    ),
  ).toContain('activation server');
  expect(
    amsSetupExplanation(
      'license-verification: COPILOT_AMS_LOGIN_FAILED_LOGIN_INVALID_CREDS',
    ),
  ).toContain('Trimble rejected');
  expect(
    retryAmsFailure('COPILOT_AMS_LOGIN_FAILED_LOGIN_CANT_REACH_SERVER'),
  ).toBe(true);
  expect(retryAmsFailure('COPILOT_AMS_LOGIN_FAILED_LOGIN_INVALID_CREDS')).toBe(
    false,
  );
});
