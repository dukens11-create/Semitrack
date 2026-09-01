import { z } from "zod";

export const subscriptionPlanUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  displayName: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable(),
  priceAmountCents: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  billingInterval: z.enum(["TRIAL", "MONTH", "YEAR", "CUSTOM"]),
  trialDays: z.number().int().min(0).max(365),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  isFeatured: z.boolean(),
  badge: z.string().trim().max(40).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict().superRefine((value, context) => {
  if (value.billingInterval === "TRIAL") {
    if (value.priceAmountCents !== 0) context.addIssue({ code: "custom", path: ["priceAmountCents"], message: "Trial price must be zero" });
    if (value.trialDays < 1) context.addIssue({ code: "custom", path: ["trialDays"], message: "Trial plans require at least one trial day" });
  } else if (value.billingInterval === "CUSTOM" && value.trialDays !== 0) {
    context.addIssue({ code: "custom", path: ["trialDays"], message: "Custom plans cannot define an app-store trial" });
  }
  if (value.isActive && ["MONTH", "YEAR"].includes(value.billingInterval) && (!value.priceAmountCents || value.priceAmountCents < 1)) {
    context.addIssue({ code: "custom", path: ["priceAmountCents"], message: "Active paid plans require a positive price" });
  }
});
