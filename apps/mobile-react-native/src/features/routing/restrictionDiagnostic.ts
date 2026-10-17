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


// Trimble Directions Report documented warning types. These labels do not
// authorize a route or override any restriction.
const warningLabels: Record<number, string> = {
  1: 'Restricted road', 2: 'Commercial-vehicle restriction',
  3: 'Height restriction', 4: 'Weight restriction',
  5: 'Road outside the National Network', 6: 'Road not designated for a 53-foot vehicle',
  7: 'Width restriction', 8: 'Length restriction', 9: 'One-way restriction',
  10: 'Road closure', 11: 'Temporary closure', 12: 'Cashless toll',
  13: 'Geofence restriction', 14: 'Special turn restriction', 15: 'Toll tag required',
  16: 'Congestion zone', 17: 'London congestion zone',
  18: 'Low-emission zone', 19: 'Ultra-low-emission zone',
};
export function restrictionMessage(types: readonly number[]) {
  if (!types.length) return null;
  return [...new Set(types.map(type => warningLabels[type] ?? 'Unclassified road warning'))].join('; ')
    + '. Review the truck-accessible entrance and actual vehicle dimensions. This route has not been accepted for navigation.';
}
