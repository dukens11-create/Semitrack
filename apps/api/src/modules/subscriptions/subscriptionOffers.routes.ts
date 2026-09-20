import { readPricing, canSuspendForPayment } from '../billing/subscriptionControls.js';
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { promotionEligibility } from '../billing/approvedOffers.js';

export const subscriptionOffersRouter = Router();
subscriptionOffersRouter.get('/', async (_req, res, next) => {
  try {
  res.setHeader('cache-control', 'no-store');
  res.json({ ...await readPricing(), purchaseAvailable: false, reason: 'provider_not_configured' });
  } catch (e) { next(e); }
});

// Read-only account view is available even while billing activation is disabled.
// No receipts, external customer identifiers, metadata or credentials leave this endpoint.
subscriptionOffersRouter.get('/account', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [subscriptions, prior, fleet] = await Promise.all([
      prisma.subscription.findMany({ where: { userId, verifiedAt: { not: null } },
        orderBy: { verifiedAt: 'desc' }, select: {
          id: true, plan: true, status: true, provider: true, environment: true, trialEnd: true,
          currentPeriodEnd: true, gracePeriodEnd: true, cancelAtPeriodEnd: true, verifiedAt: true,
        } }),
      prisma.subscriptionOfferRedemption.findUnique({ where: { userId_eligibilityGroup: { userId, eligibilityGroup: 'WELCOME_OFFER' } }, select: { id: true } }),
      prisma.fleetMembership.count({ where: { userId, unassignedAt: null } }),
    ]);
    const holds=await prisma.$queryRawUnsafe<Array<{subscriptionId:string}>>('SELECT h."subscriptionId" FROM "SubscriptionAccessHold" h JOIN "Subscription" s ON s.id=h."subscriptionId" WHERE s."userId"=$1 AND h.suspended=true',userId);
    res.setHeader('cache-control', 'private, no-store');
    res.json({
      subscriptions: subscriptions.map(({id,...s}) => ({ ...s, accessSuspended: holds.some(h=>h.subscriptionId===id), paymentAccessBlocked: canSuspendForPayment(s),
        // Current-period price/end is not proof of the next invoice or renewal.
        nextBillingCents: null, nextBillingCurrency: null, nextRenewalAt: null,
        promotionStatus: 'unknown', promotionalPeriodsRemaining: null,
      })),
      monthlyEligibility: promotionEligibility({ plan: 'monthly', fleet: fleet > 0, priorWelcomeOffer: Boolean(prior), providerConfigured: false, providerEligible: null }),
      purchaseAvailable: false,
    });
  } catch (error) { next(error); }
});
