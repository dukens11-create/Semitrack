/** Allowlisted evidence only. Never forward Warn/Message, coordinates or raw rows.
 * Numeric provider types are identifiers, not a guessed restriction taxonomy.
 */
export interface RestrictionDiagnostic {
  source: "TRIMBLE_DIRECTIONS_REPORT";
  category: "UNCLASSIFIED_PROVIDER_WARNING";
  message: "Trimble reported a warning. The route remains blocked pending review.";
  providerWarningTypes: number[];
  providerTextPresent: boolean;
  legNumber: number;
  lineNumber: number;
}
export function restrictionDiagnostic(line: unknown, legIndex: number, lineIndex: number): RestrictionDiagnostic {
  const row = line && typeof line === "object" ? line as Record<string, unknown> : {};
  const types = Array.isArray(row.DetailedWarnings) ? row.DetailedWarnings.flatMap(item => {
    const type = item && typeof item === "object" ? item.Type : undefined;
    return Number.isInteger(type) && type > 0 && type <= 9999 ? [type as number] : [];
  }) : [];
  return {
    source: "TRIMBLE_DIRECTIONS_REPORT", category: "UNCLASSIFIED_PROVIDER_WARNING",
    message: "Trimble reported a warning. The route remains blocked pending review.",
    providerWarningTypes: [...new Set(types)].slice(0, 16),
    providerTextPresent: typeof row.Warn === "string" && !!row.Warn.trim(),
    legNumber: legIndex + 1, lineNumber: lineIndex + 1,
  };
}
