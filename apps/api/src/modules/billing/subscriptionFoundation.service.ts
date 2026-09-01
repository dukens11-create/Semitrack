import type {
  BillingEnvironment,
  BillingProvider,
  EntitlementSourceType,
  Prisma,
  SubscriptionOfferKind,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { BillingFoundationError } from "./billingErrors.js";
import {
  hasPilotTrialConflict,
  shouldApplyProviderEvent,
  stripeGracePeriodEnd,
} from "./billingPolicy.js";
import { recomputeEntitlementSnapshot } from "./entitlement.service.js";
import { registerProviderEvent } from "./providerEvent.service.js";

export type VerifiedSubscriptionUpdate = {
  provider: BillingProvider;
  providerEventId: string;
  eventType: string;
  rawPayload: string | Buffer;
  eventCreatedAt: Date;
  externalObjectId?: string | null;
  userId: string;
  providerCustomerId?: string | null;
  providerSubscriptionId: string;
  providerOriginalTransactionId?: string | null;
  providerPriceId?: string | null;
  productId: string;
  catalogPlanCode?: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  environment: BillingEnvironment;
  sourceType?: EntitlementSourceType;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  gracePeriodEnd?: Date | null;
  billingRetryStartedAt?: Date | null;
  pilotStart?: Date | null;
  pilotEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  priceAmountCents?: number | null;
  priceCurrency?: string | null;
  billingInterval?: string | null;
  offerKind?: SubscriptionOfferKind | null;
  offerExternalId?: string | null;
  safeMetadata?: Prisma.InputJsonValue;
};

function accessEndForUpdate(update: VerifiedSubscriptionUpdate) {
  if ((update.status === "GRACE_PERIOD" || update.status === "BILLING_RETRY") && update.gracePeriodEnd) {
    if (!update.currentPeriodEnd || update.gracePeriodEnd > update.currentPeriodEnd) return update.gracePeriodEnd;
  }
  return update.currentPeriodEnd ?? null;
}

function isRevocationStatus(status: SubscriptionStatus) {
  return status === "REFUNDED" || status === "REVOKED";
}

export async function applyVerifiedSubscriptionUpdate(update: VerifiedSubscriptionUpdate) {
  if (hasPilotTrialConflict(update)) {
    throw new BillingFoundationError(
      "PILOT_TRIAL_NOT_ALLOWED",
      "The Founding 100 pilot discount cannot be combined with a free trial",
      409,
    );
  }
  if (update.provider === "STRIPE" && ["GRACE_PERIOD", "BILLING_RETRY"].includes(update.status)) {
    const billingRetryStartedAt = update.billingRetryStartedAt ?? update.eventCreatedAt;
    update = {
      ...update,
      billingRetryStartedAt,
      gracePeriodEnd: stripeGracePeriodEnd(billingRetryStartedAt, env.stripeGracePeriodDays),
    };
  }
  const verifiedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${update.userId} FOR UPDATE
    `;
    if (!users[0]) throw new BillingFoundationError("USER_NOT_FOUND", "Subscription user not found", 404);

    const registration = await registerProviderEvent({
      provider: update.provider,
      providerEventId: update.providerEventId,
      eventType: update.eventType,
      rawPayload: update.rawPayload,
      externalObjectId: update.externalObjectId ?? update.providerSubscriptionId,
      eventCreatedAt: update.eventCreatedAt,
      metadataJson: update.safeMetadata,
    }, tx);
    if (!registration.payloadMatches) {
      throw new BillingFoundationError(
        "PROVIDER_EVENT_PAYLOAD_MISMATCH",
        "A provider event ID was received with a different payload",
        409,
      );
    }
    if (registration.duplicate && ["PROCESSED", "IGNORED"].includes(registration.event.status)) {
      const entitlement = await recomputeEntitlementSnapshot(tx, update.userId);
      return { duplicate: true, ignored: registration.event.status === "IGNORED", subscription: null, entitlement };
    }

    const claimed = await tx.providerEvent.updateMany({
      where: {
        id: registration.event.id,
        status: { in: ["RECEIVED", "FAILED"] },
      },
      data: {
        status: "PROCESSING",
        processingStartedAt: verifiedAt,
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (claimed.count !== 1) {
      const entitlement = await recomputeEntitlementSnapshot(tx, update.userId);
      return { duplicate: true, ignored: false, subscription: null, entitlement };
    }

    const existing = await tx.subscription.findUnique({
      where: {
        provider_providerSubscriptionId: {
          provider: update.provider,
          providerSubscriptionId: update.providerSubscriptionId,
        },
      },
    });
    if (existing && existing.userId !== update.userId) {
      throw new BillingFoundationError(
        "SUBSCRIPTION_ACCOUNT_MISMATCH",
        "The verified provider subscription is already linked to another account",
        409,
      );
    }
    if (existing && !shouldApplyProviderEvent(existing.lastProviderEventAt, update.eventCreatedAt)) {
      await tx.providerEvent.update({
        where: { id: registration.event.id },
        data: { status: "IGNORED", processedAt: verifiedAt },
      });
      await tx.billingAuditLog.create({
        data: {
          action: "PROVIDER_EVENT_IGNORED_OUT_OF_ORDER",
          targetType: "SUBSCRIPTION",
          targetId: existing.id,
          provider: update.provider,
          providerEventId: update.providerEventId,
          metadataJson: {
            eventCreatedAt: update.eventCreatedAt.toISOString(),
            lastProviderEventAt: existing.lastProviderEventAt?.toISOString() ?? null,
          },
        },
      });
      const entitlement = await recomputeEntitlementSnapshot(tx, update.userId);
      return { duplicate: false, ignored: true, subscription: existing, entitlement };
    }

    const previousStatus = existing?.status ?? null;
    const subscription = await tx.subscription.upsert({
      where: {
        provider_providerSubscriptionId: {
          provider: update.provider,
          providerSubscriptionId: update.providerSubscriptionId,
        },
      },
      create: {
        userId: update.userId,
        provider: update.provider,
        providerCustomerId: update.providerCustomerId ?? null,
        providerSubscriptionId: update.providerSubscriptionId,
        providerOriginalTransactionId: update.providerOriginalTransactionId ?? null,
        providerPriceId: update.providerPriceId ?? null,
        productId: update.productId,
        catalogPlanCode: update.catalogPlanCode ?? null,
        plan: update.plan,
        status: update.status,
        environment: update.environment,
        sourceType: update.sourceType ?? "SUBSCRIPTION",
        trialStart: update.trialStart ?? null,
        trialEnd: update.trialEnd ?? null,
        currentPeriodStart: update.currentPeriodStart ?? null,
        currentPeriodEnd: update.currentPeriodEnd ?? null,
        gracePeriodEnd: update.gracePeriodEnd ?? null,
        billingRetryStartedAt: update.billingRetryStartedAt ?? null,
        pilotStart: update.pilotStart ?? null,
        pilotEnd: update.pilotEnd ?? null,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd ?? false,
        canceledAt: update.canceledAt ?? null,
        verifiedAt,
        lastProviderEventAt: update.eventCreatedAt,
        priceAmountCents: update.priceAmountCents ?? null,
        priceCurrency: update.priceCurrency?.toUpperCase() ?? null,
        billingInterval: update.billingInterval ?? null,
        rawEventJson: update.safeMetadata,
      },
      update: {
        userId: update.userId,
        providerCustomerId: update.providerCustomerId ?? null,
        providerOriginalTransactionId: update.providerOriginalTransactionId ?? null,
        providerPriceId: update.providerPriceId ?? null,
        productId: update.productId,
        catalogPlanCode: update.catalogPlanCode ?? null,
        plan: update.plan,
        status: update.status,
        environment: update.environment,
        sourceType: update.sourceType ?? "SUBSCRIPTION",
        trialStart: update.trialStart ?? null,
        trialEnd: update.trialEnd ?? null,
        currentPeriodStart: update.currentPeriodStart ?? null,
        currentPeriodEnd: update.currentPeriodEnd ?? null,
        gracePeriodEnd: update.gracePeriodEnd ?? null,
        billingRetryStartedAt: update.billingRetryStartedAt ?? null,
        pilotStart: update.pilotStart ?? null,
        pilotEnd: update.pilotEnd ?? null,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd ?? false,
        canceledAt: update.canceledAt ?? null,
        verifiedAt,
        lastProviderEventAt: update.eventCreatedAt,
        priceAmountCents: update.priceAmountCents ?? null,
        priceCurrency: update.priceCurrency?.toUpperCase() ?? null,
        billingInterval: update.billingInterval ?? null,
        rawEventJson: update.safeMetadata,
      },
    });

    if (update.offerKind) {
      const existingOffer = await tx.subscriptionOfferRedemption.findUnique({
        where: { userId_eligibilityGroup: { userId: update.userId, eligibilityGroup: "WELCOME_OFFER" } },
      });
      if (existingOffer && existingOffer.offerKind !== update.offerKind) {
        throw new BillingFoundationError(
          "WELCOME_OFFER_ALREADY_USED",
          "A different non-stackable welcome offer was already used by this account",
          409,
        );
      }
      if (existingOffer) {
        await tx.subscriptionOfferRedemption.update({
          where: { id: existingOffer.id },
          data: { subscriptionId: subscription.id, externalOfferId: update.offerExternalId ?? existingOffer.externalOfferId },
        });
      } else {
        await tx.subscriptionOfferRedemption.create({
          data: {
            userId: update.userId,
            eligibilityGroup: "WELCOME_OFFER",
            offerKind: update.offerKind,
            provider: update.provider,
            status: "REDEEMED",
            subscriptionId: subscription.id,
            externalOfferId: update.offerExternalId ?? null,
            redeemedAt: verifiedAt,
          },
        });
      }
    }

    const source = await tx.entitlementSource.upsert({
      where: {
        provider_sourceReference: {
          provider: update.provider,
          sourceReference: update.providerSubscriptionId,
        },
      },
      create: {
        userId: update.userId,
        provider: update.provider,
        sourceType: update.sourceType ?? "SUBSCRIPTION",
        sourceReference: update.providerSubscriptionId,
        subscriptionId: subscription.id,
        status: update.status,
        startsAt: update.trialStart ?? update.currentPeriodStart ?? verifiedAt,
        accessEndsAt: accessEndForUpdate(update),
        gracePeriodEndsAt: update.gracePeriodEnd ?? null,
        lastProviderEventAt: update.eventCreatedAt,
        lastVerifiedAt: verifiedAt,
        revokedAt: isRevocationStatus(update.status) ? verifiedAt : null,
        metadataJson: update.safeMetadata,
      },
      update: {
        userId: update.userId,
        sourceType: update.sourceType ?? "SUBSCRIPTION",
        subscriptionId: subscription.id,
        status: update.status,
        startsAt: update.trialStart ?? update.currentPeriodStart ?? verifiedAt,
        accessEndsAt: accessEndForUpdate(update),
        gracePeriodEndsAt: update.gracePeriodEnd ?? null,
        lastProviderEventAt: update.eventCreatedAt,
        lastVerifiedAt: verifiedAt,
        revokedAt: isRevocationStatus(update.status) ? verifiedAt : null,
        metadataJson: update.safeMetadata,
      },
    });
    await tx.subscriptionStatusEvent.create({
      data: {
        subscriptionId: subscription.id,
        providerEventId: `${update.provider}:${update.providerEventId}`,
        previousStatus,
        status: update.status,
        occurredAt: update.eventCreatedAt,
      },
    });
    await tx.billingAuditLog.create({
      data: {
        action: "VERIFIED_SUBSCRIPTION_UPDATED",
        targetType: "SUBSCRIPTION",
        targetId: subscription.id,
        provider: update.provider,
        providerEventId: update.providerEventId,
        metadataJson: { previousStatus, status: update.status, entitlementSourceId: source.id },
      },
    });
    await tx.providerEvent.update({
      where: { id: registration.event.id },
      data: { status: "PROCESSED", processedAt: verifiedAt },
    });
    const entitlement = await recomputeEntitlementSnapshot(tx, update.userId, "PREMIUM_NAVIGATION", verifiedAt);
    return { duplicate: false, ignored: false, subscription, entitlement };
  });
}
