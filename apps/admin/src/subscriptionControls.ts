export const priceFields = [
  [
    "monthlyIntro",
    "Monthly introductory price",
    "Per month for the first 3 paid periods",
  ],
  [
    "monthlyRegular",
    "Monthly renewal price",
    "Per month after the introduction",
  ],
  ["annual", "Annual plan", "Billed once per year"],
  ["fleet1", "Fleet · 1–4 drivers", "Per driver per month"],
  ["fleet5", "Fleet · 5–24 drivers", "Per driver per month"],
  ["fleet25", "Fleet · 25–99 drivers", "Per driver per month"],
  ["fleet100", "Fleet · 100–249 drivers", "Per driver per month"],
] as const;
export type PriceKey = (typeof priceFields)[number][0];
export type Prices = Record<PriceKey, number>;
export function dollarsToCents(value: string) {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a dollar amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 1 || cents > 1000000)
    throw new Error("Prices must be between $0.01 and $10,000.00.");
  return cents;
}
export function parsePriceForm(values: Record<PriceKey, string>): Prices {
  const prices = Object.fromEntries(
    priceFields.map(([key]) => [key, dollarsToCents(values[key])])
  ) as Prices;
  if (prices.monthlyIntro > prices.monthlyRegular)
    throw new Error("The introductory price cannot exceed the renewal price.");
  if (
    prices.fleet1 < prices.fleet5 ||
    prices.fleet5 < prices.fleet25 ||
    prices.fleet25 < prices.fleet100
  )
    throw new Error("Volume prices must not increase with fleet size.");
  return prices;
}
export type SubscriptionRow = {
  id: string;
  plan: string;
  provider: string;
  status: string;
  environment: string;
  verifiedAt: string | null;
  gracePeriodEnd: string | null;
  currentPeriodEnd: string | null;
  user: { fullName: string; email: string };
  hold: { version: number; suspended: boolean };
  canSuspend: boolean;
  canRestore: boolean;
};
export function accessControlLabel(row: SubscriptionRow) {
  if (row.hold.suspended) return "Suspended by admin";
  if (row.canSuspend) return "Payment overdue · access withheld";
  if (["GRACE_PERIOD", "BILLING_RETRY", "PAST_DUE"].includes(row.status))
    return "Review verified grace period";
  return "No admin suspension";
}
