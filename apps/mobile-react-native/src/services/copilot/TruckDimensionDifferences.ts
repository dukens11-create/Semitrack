const fields = {
  heightInches: ['Height', 'in'],
  widthInches: ['Width', 'in'],
  lengthInches: ['CoPilot length', 'in'],
  maximumStraightLengthInches: ['Maximum straight length', 'in'],
  trailerCount: ['Trailer count', ''],
  bumperToBumperLengthInches: ['Bumper-to-bumper length', 'in'],
  totalWeightLbs: ['Total routing weight', 'lb'],
  axleGroupWeightLbs: ['Axle-group routing weight', 'lb'],
} as const;
export type DimensionDifference = {
  field: keyof typeof fields;
  expected: number;
  actual: number | null;
  comparison: 'equal' | 'minimum';
};
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Only known fields and bounded numeric values enter UI/shared diagnostics. */
export function truckDimensionDifferences(
  error: unknown,
): DimensionDifference[] {
  const e = record(error);
  if (e?.code !== 'TRUCK_DIMENSIONS_MISMATCH') return [];
  const rows = record(e.userInfo)?.dimensionMismatches;
  if (!Array.isArray(rows)) return [];
  const result: DimensionDifference[] = [];
  const number = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1000000;
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const row = rows.map(record).find(r => r?.field === field);
    const comparison =
      field === 'bumperToBumperLengthInches' ? 'minimum' : 'equal';
    if (
      row &&
      number(row.expected) &&
      (row.actual === null || number(row.actual)) &&
      row.comparison === comparison
    ) {
      result.push({
        field,
        expected: row.expected,
        actual: row.actual,
        comparison,
      });
    }
  }
  return result;
}
export function truckDimensionMessage(error: unknown): string {
  const rows = truckDimensionDifferences(error);
  if (!rows.length)
    return 'The engine dimensions or axle-group weight do not match your saved truck. Review both profiles; no settings were changed.';
  return (
    'Truck profile differences:\n\n' +
    rows
      .map(row => {
        const [label, unit] = fields[row.field];
        const expected = `${row.comparison === 'minimum' ? 'at least ' : ''}${
          row.expected
        } ${unit}`.trim();
        const actual =
          row.actual === null ? 'not reported' : `${row.actual} ${unit}`.trim();
        return `${label}: required ${expected}; CoPilot ${actual}.`;
      })
      .join('\n') +
    '\n\nOpen Trimble map and guidance settings to review the active truck profile, or edit an incorrect saved truck value. Checking the profiles does not copy settings. Keep actual vehicle dimensions and load weights; no settings were changed.'
  );
}
