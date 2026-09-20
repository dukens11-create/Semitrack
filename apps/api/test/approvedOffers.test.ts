import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionPricing as p, plannedIndividualPrice } from '../dist/contracts/subscriptionPricing.js';
import { promotionEligibility, mayContinueWelcomeOffer } from '../dist/modules/billing/approvedOffers.js';
import { fleetPricingTier } from '../dist/modules/billing/billingPolicy.js';
import { parseBillingConfiguration } from '../dist/config/billingConfig.js';

test('approved trial is 14 days; trial does not consume a paid introductory period', () => {
  assert.equal(p.trialDays, 14); assert.equal(parseBillingConfiguration({}).stripeTrialDays, 14);
  assert.equal(plannedIndividualPrice('monthly', 'trial', 0), 0);
  assert.equal(p.monthly.introPaidPeriods, 3);
  assert.throws(() => plannedIndividualPrice('monthly', 'trial', 1));
});
for (const [period, cents] of [[1,1499],[2,1499],[3,1499],[4,1999],[12,1999]]) {
  test(`monthly paid period ${period} uses ${cents} cents`, () => assert.equal(plannedIndividualPrice('monthly','paid',period!),cents));
}
test('annual never receives the monthly introductory rate', () => {
  assert.equal(plannedIndividualPrice('annual','trial',0),0);
  for (const period of [1,2,3,4]) assert.equal(plannedIndividualPrice('annual','paid',period),19999);
});
test('invalid billing period counts cannot masquerade as paid periods', () => {
  for (const period of [0,-1,1.5,NaN,Infinity]) assert.throws(()=>plannedIndividualPrice('monthly','paid',period));
});
for (const [seats,cents] of [[1,1999],[4,1999],[5,1799],[24,1799],[25,1599],[99,1599],[100,1399],[249,1399],[250,null],[1000,null]]) {
  test(`fleet ${seats} seat boundary`, () => {
    const tier=fleetPricingTier(seats!); assert.equal(tier.unitPriceCents,cents); assert.equal(tier.requiresSalesContact,cents===null);
  });
}
test('eligibility requires both server history and authoritative provider confirmation', () => {
  const base={plan:'monthly' as const,fleet:false,priorWelcomeOffer:false,providerConfigured:true,providerEligible:true};
  assert.equal(promotionEligibility(base),'eligible');
  assert.equal(promotionEligibility({...base,providerEligible:null}),'unknown');
  assert.equal(promotionEligibility({...base,providerConfigured:false}),'provider_not_configured');
  assert.equal(promotionEligibility({...base,providerEligible:false}),'already_used');
  assert.equal(promotionEligibility({...base,priorWelcomeOffer:true}),'already_used');
  assert.equal(promotionEligibility({...base,fleet:true}),'fleet_account');
  assert.equal(promotionEligibility({...base,plan:'annual'}),'annual_selected');
});
test('same-offer cancel/rejoin is denied, original renewals allowed, no stacking', () => {
  const prior={offerKind:'INTRODUCTORY_OFFER',subscriptionId:'original',provider:'GOOGLE_PLAY',status:'REDEEMED',invitationId:null};
  assert.equal(mayContinueWelcomeOffer(prior,{...prior,subscriptionId:'original'}),true);
  assert.equal(mayContinueWelcomeOffer(prior,{...prior,subscriptionId:'new'}),false);
  assert.equal(mayContinueWelcomeOffer(prior,{...prior,offerKind:'REGULAR_TRIAL'}),false);
  assert.equal(mayContinueWelcomeOffer(prior,{...prior,provider:'APPLE'}),false);
  assert.equal(mayContinueWelcomeOffer({...prior,status:'REVOKED'},prior),false);
  assert.equal(mayContinueWelcomeOffer({...prior,subscriptionId:null},prior),false);
});
test('approved historical pilot claims may attach once to first verified Stripe subscription', () => {
  const prior={offerKind:'PILOT_DISCOUNT',subscriptionId:null,provider:'PILOT',status:'REDEEMED',invitationId:'invitation'};
  const incoming={offerKind:'PILOT_DISCOUNT',subscriptionId:'first',provider:'STRIPE'};
  assert.equal(mayContinueWelcomeOffer(prior,incoming),true);
  assert.equal(mayContinueWelcomeOffer({...prior,subscriptionId:'first'},incoming),true);
  assert.equal(mayContinueWelcomeOffer({...prior,invitationId:null},incoming),false);
  assert.equal(mayContinueWelcomeOffer({...prior,subscriptionId:'first',provider:'STRIPE'}, {...incoming,subscriptionId:'second'}),false);
});
test('catalog preserves product identifiers and does not invent provider price or offer IDs', () => {
  assert.equal(p.products.GOOGLE_PLAY.product,'semitrax_premium');
  assert.equal(p.products.APPLE.monthly,'com.semitrax.premium.monthly');
  assert.equal(p.products.GOOGLE_PLAY.offerId,null);
  assert.equal(p.products.APPLE.offerId,null);
  assert.equal(p.products.STRIPE.monthlyPriceId,null);
});
