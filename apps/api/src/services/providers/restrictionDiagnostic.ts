/** Allowlisted evidence only. Never forward Warn/Message, coordinates or raw rows.
 * Numeric provider types are identifiers, not a guessed restriction taxonomy.
 */
export interface RestrictionDiagnostic {
  source: "TRIMBLE_DIRECTIONS_REPORT";
  category: "UNCLASSIFIED_PROVIDER_WARNING";
  message: "Trimble reported a warning. The route remains blocked pending review.";
  providerWarningTypes: number[];
  providerTextPresent: boolean;
  malformedWarningEvidencePresent: boolean;
  legNumber: number;
  lineNumber: number;
}
export function restrictionDiagnostic(line: unknown, legIndex: number, lineIndex: number): RestrictionDiagnostic {
  const row = line && typeof line === "object" ? line as Record<string, unknown> : {};
  const detailedWarnings = Array.isArray(row.DetailedWarnings) ? row.DetailedWarnings : [];
  const types = detailedWarnings.flatMap(item => {
    const type = item && typeof item === "object" ? item.Type : undefined;
    return Number.isInteger(type) && type > 0 && type <= 9999 ? [type as number] : [];
  });
  const malformedWarningEvidencePresent = detailedWarnings.some(item => {
    if (!item || typeof item !== "object") return true;
    const type = (item as Record<string, unknown>).Type;
    return !Number.isInteger(type) || (type as number) < 0 || (type as number) > 9999;
  });
  return {
    source: "TRIMBLE_DIRECTIONS_REPORT", category: "UNCLASSIFIED_PROVIDER_WARNING",
    message: "Trimble reported a warning. The route remains blocked pending review.",
    providerWarningTypes: [...new Set(types)].slice(0, 16),
    providerTextPresent: typeof row.Warn === "string" && !!row.Warn.trim(),
    malformedWarningEvidencePresent,
    legNumber: legIndex + 1, lineNumber: lineIndex + 1,
  };
}
