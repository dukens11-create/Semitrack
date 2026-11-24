import type { CoPilotSetupDiagnostics } from './CoPilotHost';

export function enrollmentMatchLabel(
  diagnostics: CoPilotSetupDiagnostics,
  field:
    | 'savedCompanyMatches'
    | 'savedDeviceMatches'
    | 'hookMatchedAssigned'
    | 'callbackMatchedAssigned',
): string {
  if (diagnostics.enrollmentReferenceConfigured !== true)
    return 'Not evaluated (no verified assignment reference)';
  if (
    (field === 'savedCompanyMatches' || field === 'savedDeviceMatches') &&
    diagnostics.savedSetupPresent === false
  )
    return 'No saved setup';
  return diagnostics[field] ? 'Yes' : 'No';
}
