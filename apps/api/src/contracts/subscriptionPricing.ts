// Approved offers only. This catalog never grants access or changes an existing contract.
export const subscriptionPricing = {
  revision: '2026-09-19', currency: 'USD', trialDays: 14,
  monthly: {
    regularCents: 1999, introCents: 1499, introPaidPeriods: 3,
    summary: '14 days free. Then $14.99/month for your first 3 months. After that, $19.99/month until canceled.',
    renewal: 'Your subscription automatically renews at $19.99/month after the introductory period unless canceled before renewal.',
  },
  annual: {
    priceCents: 19999,
    summary: '14 days free. Then $199.99/year.',
    renewal: 'Your subscription automatically renews at $199.99/year unless canceled before renewal.',
  },
  fleet: [
    { min: 1, max: 4, label: '1–4 drivers', cents: 1999 },
    { min: 5, max: 24, label: '5–24 drivers', cents: 1799 },
    { min: 25, max: 99, label: '25–99 drivers', cents: 1599 },
    { min: 100, max: 249, label: '100–249 drivers', cents: 1399 },
    { min: 250, max: null, label: '250+ drivers', cents: null },
  ],
  salesEmail: 'contact@semitrax.com',
  products: {
    GOOGLE_PLAY: { product: 'semitrax_premium', monthly: 'monthly', annual: 'annual', offerId: null },
    APPLE: { monthly: 'com.semitrax.premium.monthly', annual: 'com.semitrax.premium.annual', offerId: null },
    STRIPE: { monthlyPriceId: null, annualPriceId: null, introductoryPriceId: null },
  },
} as const;

export type PromotionEligibility = 'eligible' | 'already_used' | 'fleet_account' | 'annual_selected' | 'provider_not_configured' | 'unknown';

// Display/schedule planning only. Never use this calculation as an entitlement or invoice.
// A provider-verified paid-period count is required; signup time is deliberately not accepted.
export function plannedIndividualPrice(plan: 'monthly' | 'annual', phase: 'trial' | 'paid', paidPeriod: number) {
  if (!Number.isSafeInteger(paidPeriod) || (phase === 'paid' ? paidPeriod < 1 : paidPeriod !== 0)) {
    throw new Error('A valid paid billing-period number is required');
  }
  if (phase === 'trial') return 0;
  if (plan === 'annual') return subscriptionPricing.annual.priceCents;
  return paidPeriod <= subscriptionPricing.monthly.introPaidPeriods
    ? subscriptionPricing.monthly.introCents : subscriptionPricing.monthly.regularCents;
}

export type SubscriptionPrices = { monthlyRegular:number; monthlyIntro:number; annual:number; fleet1:number; fleet5:number; fleet25:number; fleet100:number };
export const defaultSubscriptionPrices: SubscriptionPrices = {monthlyRegular:1999,monthlyIntro:1499,annual:19999,fleet1:1999,fleet5:1799,fleet25:1599,fleet100:1399};
export function createSubscriptionPricing(prices: SubscriptionPrices) {
  const money=(cents:number)=>'$'+(cents/100).toFixed(2);
  const fleetPrices=[prices.fleet1,prices.fleet5,prices.fleet25,prices.fleet100,null];
  return {...subscriptionPricing,
    monthly:{...subscriptionPricing.monthly,regularCents:prices.monthlyRegular,introCents:prices.monthlyIntro,
      summary:'14 days free. Then '+money(prices.monthlyIntro)+'/month for your first 3 months. After that, '+money(prices.monthlyRegular)+'/month until canceled.',
      renewal:'Your subscription automatically renews at '+money(prices.monthlyRegular)+'/month after the introductory period unless canceled before renewal.'},
    annual:{...subscriptionPricing.annual,priceCents:prices.annual,summary:'14 days free. Then '+money(prices.annual)+'/year.',
      renewal:'Your subscription automatically renews at '+money(prices.annual)+'/year unless canceled before renewal.'},
    fleet:subscriptionPricing.fleet.map((tier,i)=>({...tier,cents:fleetPrices[i]??null})),
  };
}
