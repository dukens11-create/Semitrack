export type AnalyticsRange = {
  preset: "today" | "7d" | "30d" | "3m" | "1y" | "custom";
  from: Date;
  to: Date;
  bucket: "hour" | "day" | "month";
};

export function parseAnalyticsRange(query: Record<string, unknown>, now = new Date()): AnalyticsRange {
  const preset = String(query.range ?? "30d").toLowerCase() as AnalyticsRange["preset"];
  const allowed = new Set(["today", "7d", "30d", "3m", "1y", "custom"]);
  if (!allowed.has(preset)) throw new Error("Unsupported analytics date range");

  const to = preset === "custom" && query.to ? new Date(String(query.to)) : now;
  let from: Date;
  if (preset === "custom") {
    from = new Date(String(query.from ?? ""));
  } else if (preset === "today") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "3m" ? 92 : 365;
    from = new Date(to.getTime() - days * 86_400_000);
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error("Invalid analytics date range");
  }
  if (to.getTime() - from.getTime() > 2 * 365 * 86_400_000) {
    throw new Error("Analytics date range cannot exceed two years");
  }
  const durationDays = (to.getTime() - from.getTime()) / 86_400_000;
  return { preset, from, to, bucket: durationDays <= 2 ? "hour" : durationDays > 180 ? "month" : "day" };
}
