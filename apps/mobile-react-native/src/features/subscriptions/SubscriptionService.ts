import { Linking } from 'react-native';
import { z } from 'zod';
export {
  subscriptionPricing,
  createSubscriptionPricing,
  defaultSubscriptionPrices,
} from '../../../../api/src/contracts/subscriptionPricing';

export const subscriptionAccountSchema = z.object({
  purchaseAvailable: z.literal(false),
  monthlyEligibility: z.enum([
    'eligible',
    'already_used',
    'fleet_account',
    'annual_selected',
    'provider_not_configured',
    'unknown',
  ]),
  subscriptions: z
    .array(
      z.object({
        accessSuspended: z.boolean().optional(),
        paymentAccessBlocked: z.boolean().optional(),
        gracePeriodEnd: z.string().datetime().nullable().optional(),
        plan: z.enum(['FREE', 'GOLD', 'DIAMOND', 'TEAM']),
        status: z.string().regex(/^[A-Z_]{1,40}$/),
        provider: z.enum([
          'GOOGLE_PLAY',
          'APPLE',
          'STRIPE',
          'PILOT',
          'ADMIN_GRANT',
        ]),
        environment: z.enum(['TEST', 'SANDBOX', 'PRODUCTION']),
        trialEnd: z.string().datetime().nullable(),
        currentPeriodEnd: z.string().datetime().nullable(),
        cancelAtPeriodEnd: z.boolean(),
        verifiedAt: z.string().datetime(),
        nextBillingCents: z.number().int().nonnegative().nullable(),
        nextBillingCurrency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        nextRenewalAt: z.string().datetime().nullable(),
        promotionStatus: z.enum([
          'unknown',
          'active',
          'ended',
          'not_applicable',
        ]),
        promotionalPeriodsRemaining: z.number().int().min(0).max(3).nullable(),
      }),
    )
    .max(100),
});
export type SubscriptionAccount = z.infer<typeof subscriptionAccountSchema>;

export const eligibilityCopy: Record<
  SubscriptionAccount['monthlyEligibility'],
  string
> = {
  eligible:
    'Eligibility confirmed by the backend. Store offer activation is still required.',
  already_used:
    'A welcome offer was already used or reserved. It cannot be claimed again or combined with another introduction.',
  fleet_account:
    'Fleet accounts use their fleet agreement, not the individual introductory offer.',
  annual_selected:
    'The annual plan does not include the monthly introductory price.',
  provider_not_configured:
    'Purchases are not available yet. Store offers and eligibility verification are pending.',
  unknown:
    'Offer eligibility is unavailable. Eligibility must be confirmed before purchase.',
};

// No native store purchase/receipt bridge is configured in this build. Never substitute Stripe.
export function subscriptionAdapter(platform: string) {
  const provider =
    platform === 'android'
      ? 'GOOGLE_PLAY'
      : platform === 'ios'
      ? 'APPLE'
      : null;
  return {
    provider,
    canPurchase: false as const,
    canRestore: false as const,
    async purchase(_plan: 'monthly' | 'annual'): Promise<never> {
      throw new Error(
        'Store purchases are unavailable; no subscription was activated.',
      );
    },
    async restore(): Promise<never> {
      throw new Error(
        'Restore purchases is unavailable until store receipt verification is configured.',
      );
    },
    async manage(recordProvider: string) {
      if (!provider || recordProvider !== provider)
        throw new Error(
          'Manage this subscription with its original billing provider.',
        );
      const url =
        provider === 'GOOGLE_PLAY'
          ? 'https://play.google.com/store/account/subscriptions'
          : 'https://apps.apple.com/account/subscriptions';
      await Linking.openURL(url);
    },
  };
}

const displayAmount = z.number().int().min(1).max(1000000);
export const publishedPricingSchema = z.object({
  version: z.number().int().positive(),
  prices: z
    .object({
      monthlyRegular: displayAmount,
      monthlyIntro: displayAmount,
      annual: displayAmount,
      fleet1: displayAmount,
      fleet5: displayAmount,
      fleet25: displayAmount,
      fleet100: displayAmount,
    })
    .strict()
    .refine(
      p =>
        p.monthlyIntro <= p.monthlyRegular &&
        p.fleet1 >= p.fleet5 &&
        p.fleet5 >= p.fleet25 &&
        p.fleet25 >= p.fleet100,
    ),
});
