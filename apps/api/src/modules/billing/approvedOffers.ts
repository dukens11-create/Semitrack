import type { PromotionEligibility } from '../../contracts/subscriptionPricing.js';

// Inputs must come from verified server/provider records, never a client eligibility flag.
export function promotionEligibility(input: {
  plan: 'monthly' | 'annual'; fleet: boolean; priorWelcomeOffer: boolean;
  providerConfigured: boolean; providerEligible: boolean | null;
}): PromotionEligibility {
  if (input.fleet) return 'fleet_account';
  if (input.plan === 'annual') return 'annual_selected';
  if (input.priorWelcomeOffer || input.providerEligible === false) return 'already_used';
  if (!input.providerConfigured) return 'provider_not_configured';
  return input.providerEligible === true ? 'eligible' : 'unknown';
}

// Renewal events may update their original claim. Cancel/rejoin and another offer cannot reclaim it.
export function mayContinueWelcomeOffer(existing: {
  offerKind: string; subscriptionId: string | null; provider: string; status: string; invitationId: string | null;
}, incoming: { offerKind: string; subscriptionId: string; provider: string }) {
  if (existing.status === 'REVOKED' || existing.offerKind !== incoming.offerKind) return false;
  const legacyPilot = existing.offerKind === 'PILOT_DISCOUNT' && Boolean(existing.invitationId)
    && existing.provider === 'PILOT' && incoming.provider === 'STRIPE';
  if (existing.subscriptionId) return existing.subscriptionId === incoming.subscriptionId
    && (existing.provider === incoming.provider || legacyPilot);
  // Existing administrator-approved pilot invitations use PILOT until the first verified Stripe subscription.
  return existing.offerKind === 'PILOT_DISCOUNT' && existing.status === 'REDEEMED'
    && Boolean(existing.invitationId) && existing.provider === 'PILOT' && incoming.provider === 'STRIPE';
}
