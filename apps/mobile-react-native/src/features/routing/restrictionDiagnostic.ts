/** This boundary intentionally ignores all unapproved text/fields from the API. */
export function sanitizeRestrictionDiagnostic(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    v.source !== 'TRIMBLE_DIRECTIONS_REPORT' ||
    v.category !== 'UNCLASSIFIED_PROVIDER_WARNING' ||
    typeof v.providerTextPresent !== 'boolean' ||
    typeof v.malformedWarningEvidencePresent !== 'boolean' ||
    !Number.isInteger(v.legNumber) ||
    Number(v.legNumber) < 1 ||
    Number(v.legNumber) > 1000 ||
    !Number.isInteger(v.lineNumber) ||
    Number(v.lineNumber) < 1 ||
    Number(v.lineNumber) > 100000 ||
    !Array.isArray(v.providerWarningTypes)
  )
    return null;
  return {
    source: 'TRIMBLE_DIRECTIONS_REPORT',
    category: 'UNCLASSIFIED_PROVIDER_WARNING',
    message:
      'Trimble reported a warning. The route remains blocked pending review.',
    providerWarningTypes: [
      ...new Set(
        v.providerWarningTypes.filter(
          (t): t is number =>
            typeof t === 'number' && Number.isInteger(t) && t > 0 && t <= 9999,
        ),
      ),
    ].slice(0, 16),
    providerTextPresent: v.providerTextPresent,
    malformedWarningEvidencePresent: v.malformedWarningEvidencePresent,
    legNumber: Number(v.legNumber),
    lineNumber: Number(v.lineNumber),
  };
}
