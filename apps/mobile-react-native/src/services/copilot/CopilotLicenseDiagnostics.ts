// Only fixed SDK enum names and app-owned codes may appear in diagnostics.
export const amsLoginFailures = [
  'FAILED_DEVICEID_TOO_LONG',
  'FAILED_LICENSE_EXPIRED',
  'FAILED_INVALID_LICENSE_KEY',
  'FAILED_COPILOT_NOT_STARTED',
  'FAILED_LICENSING_NOT_READY',
  'FAILED_ROUTE_IN_PROGRESS',
  'FAILED_AMS_IN_USE',
  'FAILED_LOGIN_CANT_REACH_SERVER',
  'FAILED_LOGIN_INVALID_CREDS',
  'FAILED_LOGIN_DEVICE_LIMIT_REACHED',
  'FAILED_LOGIN_NO_ACTIVE_LICENSES',
  'FAILED_LOGIN_ASSET_DOESNOT_EXIST',
  'FAILED_GENERAL_ERROR',
] as const;
export const amsDiagnosticCodes: readonly string[] = [
  ...amsLoginFailures.map(code => 'COPILOT_AMS_LOGIN_' + code),
  'COPILOT_AMS_HOOK_NOT_CALLED',
  'COPILOT_AMS_HOOK_QUERY_FAILED',
  'COPILOT_AMS_ACCOUNT_CHANGE_BLOCKED',
  'COPILOT_AMS_ASSIGNMENT_MISSING',
  'COPILOT_AMS_LOGIN_RESPONSE_PENDING',
  'COPILOT_AMS_LOGIN_NO_RESPONSE',
];
export function retryAmsFailure(code: unknown): boolean {
  if (typeof code !== 'string') return true;
  if (
    [
      'COPILOT_AMS_LOGIN_RESPONSE_PENDING',
      'COPILOT_AMS_LOGIN_NO_RESPONSE',
    ].includes(code)
  )
    return true;
  if (code.startsWith('COPILOT_AMS_LOGIN_'))
    return [
      'COPILOT_AMS_LOGIN_FAILED_LOGIN_CANT_REACH_SERVER',
      'COPILOT_AMS_LOGIN_FAILED_GENERAL_ERROR',
      'COPILOT_AMS_LOGIN_FAILED_COPILOT_NOT_STARTED',
      'COPILOT_AMS_LOGIN_FAILED_LICENSING_NOT_READY',
    ].includes(code);
  return ![
    'COPILOT_AMS_COMPANY_MISMATCH',
    'COPILOT_AMS_DEVICE_MISMATCH',
    'COPILOT_AMS_ACCOUNT_CHANGE_BLOCKED',
    'COPILOT_AMS_ASSIGNMENT_MISSING',
    'COPILOT_AMS_HOOK_NOT_CALLED',
    'COPILOT_AMS_HOOK_QUERY_FAILED',
  ].includes(code);
}
export function amsSetupExplanation(operation: string | null): string | null {
  const code = operation?.split(': ')[1];
  switch (code) {
    case 'COPILOT_AMS_LOGIN_RESPONSE_PENDING':
      return 'The native credential hook supplied saved setup. Waiting for Trimble’s login response; activation is not confirmed.';
    case 'COPILOT_AMS_LOGIN_NO_RESPONSE':
      return 'The native credential hook supplied saved setup, but no login response arrived within the recovery window. Report this stage for native SDK investigation.';
    case 'COPILOT_AMS_IDENTITY_MISSING':
      return 'CoPilot has started, but Account Manager login is not confirmed. Saved setup alone does not confirm activation.';
    case 'COPILOT_AMS_LOGIN_FAILED_LOGIN_CANT_REACH_SERVER':
      return 'CoPilot could not reach Trimble’s activation server. Keep an internet connection available; the app retries automatically.';
    case 'COPILOT_AMS_LOGIN_FAILED_LOGIN_INVALID_CREDS':
    case 'COPILOT_AMS_LOGIN_FAILED_LOGIN_ASSET_DOESNOT_EXIST':
      return 'Trimble rejected the assigned login. Verify this phone’s Company ID and Device ID in Account Manager.';
    case 'COPILOT_AMS_LOGIN_FAILED_LOGIN_DEVICE_LIMIT_REACHED':
    case 'COPILOT_AMS_LOGIN_FAILED_AMS_IN_USE':
      return 'Trimble reports the assignment is already in use or its device limit is reached. An administrator must review the existing assignment.';
    case 'COPILOT_AMS_LOGIN_FAILED_LOGIN_NO_ACTIVE_LICENSES':
    case 'COPILOT_AMS_LOGIN_FAILED_LICENSE_EXPIRED':
      return 'Trimble reports no active license for this assignment. An administrator must check its license and expiration.';
    case 'COPILOT_AMS_ACCOUNT_CHANGE_BLOCKED':
    case 'COPILOT_AMS_COMPANY_MISMATCH':
    case 'COPILOT_AMS_DEVICE_MISMATCH':
      return 'CoPilot reports a different account identity. Existing licenses are preserved; account replacement is blocked.';
    case 'COPILOT_AMS_HOOK_NOT_CALLED':
    case 'COPILOT_AMS_HOOK_QUERY_FAILED':
      return 'CoPilot did not complete the native credential handoff. Restart the app and report this setup stage if it remains.';
    default:
      return null;
  }
}
