import crypto from "node:crypto";
import type { PilotCampaignStatus, Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { BillingFoundationError } from "./billingErrors.js";
import { pilotCapacityAvailable } from "./billingPolicy.js";

const welcomeOfferGroup = "WELCOME_OFFER";
const reservingInvitationStatuses = ["APPROVED", "DELIVERED"] as const;

function availableConfiguredPilotSlots(campaign: {
  redemptionLimit: number;
  reservedCount: number;
  redeemedCount: number;
}) {
  return pilotCapacityAvailable({
    redemptionLimit: Math.min(campaign.redemptionLimit, env.pilotMaxRedemptions),
    reservedCount: campaign.reservedCount,
    redeemedCount: campaign.redeemedCount,
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createPilotInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPilotInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function lockCampaignAndReconcile(
  tx: Prisma.TransactionClient,
  campaignCode: string,
  now: Date,
) {
  await tx.$queryRaw<Array<{ code: string }>>`
    SELECT "code" FROM "PilotCampaign" WHERE "code" = ${campaignCode} FOR UPDATE
  `;
  const campaign = await tx.pilotCampaign.findUnique({ where: { code: campaignCode } });
  if (!campaign) throw new BillingFoundationError("PILOT_CAMPAIGN_NOT_FOUND", "Pilot campaign not found", 404);

  const expired = await tx.pilotInvitation.findMany({
    where: {
      campaignCode,
      status: { in: [...reservingInvitationStatuses] },
      expiresAt: { lte: now },
    },
    select: { id: true },
  });
  if (expired.length) {
    const ids = expired.map((invitation) => invitation.id);
    await tx.pilotInvitation.updateMany({
      where: { id: { in: ids }, status: { in: [...reservingInvitationStatuses] } },
      data: { status: "EXPIRED" },
    });
    for (const invitation of expired) {
      await tx.pilotInvitationEvent.create({
        data: { invitationId: invitation.id, type: "EXPIRED", metadataJson: { reason: "INVITATION_TTL_ELAPSED" } },
      });
      await tx.billingAuditLog.create({
        data: {
          action: "PILOT_INVITATION_EXPIRED",
          targetType: "PILOT_INVITATION",
          targetId: invitation.id,
          provider: "PILOT",
          metadataJson: { reason: "INVITATION_TTL_ELAPSED" },
        },
      });
    }
  }

  const [reservedCount, redeemedCount] = await Promise.all([
    tx.pilotInvitation.count({
      where: {
        campaignCode,
        status: { in: [...reservingInvitationStatuses] },
        expiresAt: { gt: now },
      },
    }),
    tx.pilotInvitation.count({ where: { campaignCode, redeemedAt: { not: null } } }),
  ]);
  return tx.pilotCampaign.update({
    where: { code: campaignCode },
    data: { reservedCount, redeemedCount },
  });
}

function assertCampaignAcceptsApprovals(campaign: Awaited<ReturnType<typeof lockCampaignAndReconcile>>, now: Date) {
  if (campaign.status !== "ACTIVE") {
    throw new BillingFoundationError("PILOT_CAMPAIGN_INACTIVE", "Pilot campaign is not accepting approvals", 409);
  }
  if ((campaign.startsAt && campaign.startsAt > now) || (campaign.endsAt && campaign.endsAt <= now)) {
    throw new BillingFoundationError("PILOT_CAMPAIGN_OUTSIDE_WINDOW", "Pilot campaign is outside its approval window", 409);
  }
  if (availableConfiguredPilotSlots(campaign) < 1) {
    throw new BillingFoundationError("PILOT_CAPACITY_REACHED", "The 100-driver pilot is full", 409);
  }
}

export async function approvePilotInvitation(input: {
  email: string;
  userId?: string;
  expiresAt?: Date;
  administratorUserId: string;
  ipAddress?: string;
}) {
  const now = new Date();
  const email = normalizeEmail(input.email);
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + env.pilotReservationMinutes * 60_000);
  if (expiresAt <= now) throw new BillingFoundationError("INVALID_INVITATION_EXPIRY", "Invitation expiry must be in the future");
  const token = createPilotInvitationToken();
  const tokenHash = hashPilotInvitationToken(token);

  const invitation = await prisma.$transaction(async (tx) => {
    const campaign = await lockCampaignAndReconcile(tx, env.pilotCampaignCode, now);
    assertCampaignAcceptsApprovals(campaign, now);

    const requestedUser = input.userId
      ? await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, disabledAt: true } })
      : await tx.user.findUnique({ where: { email }, select: { id: true, email: true, disabledAt: true } });
    if (input.userId && !requestedUser) throw new BillingFoundationError("USER_NOT_FOUND", "Approved user not found", 404);
    if (requestedUser?.disabledAt) throw new BillingFoundationError("USER_DISABLED", "A disabled user cannot join the pilot", 409);
    if (requestedUser && normalizeEmail(requestedUser.email) !== email) {
      throw new BillingFoundationError("PILOT_EMAIL_MISMATCH", "Invitation email does not match the approved user", 409);
    }

    if (requestedUser) {
      const priorOffer = await tx.subscriptionOfferRedemption.findUnique({
        where: { userId_eligibilityGroup: { userId: requestedUser.id, eligibilityGroup: welcomeOfferGroup } },
      });
      if (priorOffer) {
        throw new BillingFoundationError("WELCOME_OFFER_ALREADY_USED", "This user has already received a non-stackable offer", 409);
      }
    }

    const priorInvitation = await tx.pilotInvitation.findFirst({
      where: {
        campaignCode: campaign.code,
        status: { in: ["APPROVED", "DELIVERED", "REDEEMED"] },
        OR: [
          { email },
          ...(requestedUser ? [{ userId: requestedUser.id }] : []),
        ],
      },
      select: { id: true },
    });
    if (priorInvitation) {
      throw new BillingFoundationError("PILOT_INVITATION_EXISTS", "This driver already has a pilot invitation", 409);
    }

    const created = await tx.pilotInvitation.create({
      data: {
        campaignCode: campaign.code,
        tokenHash,
        email,
        userId: requestedUser?.id ?? null,
        expiresAt,
        approvedByUserId: input.administratorUserId,
      },
    });
    await tx.pilotCampaign.update({ where: { code: campaign.code }, data: { reservedCount: { increment: 1 } } });
    await tx.pilotInvitationEvent.create({
      data: { invitationId: created.id, type: "APPROVED", actorUserId: input.administratorUserId },
    });
    await tx.adminAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_INVITATION_APPROVED",
        targetType: "PILOT_INVITATION",
        targetId: created.id,
        ipAddress: input.ipAddress,
        metadataJson: { email, userId: requestedUser?.id ?? null, expiresAt: expiresAt.toISOString() },
      },
    });
    await tx.billingAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_INVITATION_APPROVED",
        targetType: "PILOT_INVITATION",
        targetId: created.id,
        provider: "PILOT",
        ipAddress: input.ipAddress,
        metadataJson: { email, userId: requestedUser?.id ?? null, expiresAt: expiresAt.toISOString() },
      },
    });
    return created;
  });

  return { invitation, token };
}

export async function markPilotInvitationDelivered(input: {
  invitationId: string;
  administratorUserId: string;
  ipAddress?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.pilotInvitation.findUnique({ where: { id: input.invitationId } });
    if (!initial) return { kind: "missing" as const };
    await lockCampaignAndReconcile(tx, initial.campaignCode, new Date());
    const invitation = await tx.pilotInvitation.findUniqueOrThrow({ where: { id: initial.id } });
    if (invitation.status === "DELIVERED") return { kind: "delivered" as const, invitation };
    if (invitation.status === "EXPIRED") return { kind: "expired" as const };
    if (invitation.status !== "APPROVED") {
      return { kind: "invalid_status" as const };
    }
    const delivered = await tx.pilotInvitation.update({
      where: { id: invitation.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), deliveredByUserId: input.administratorUserId },
    });
    await tx.pilotInvitationEvent.create({
      data: { invitationId: invitation.id, type: "DELIVERED", actorUserId: input.administratorUserId },
    });
    await tx.billingAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_INVITATION_DELIVERED",
        targetType: "PILOT_INVITATION",
        targetId: invitation.id,
        provider: "PILOT",
        ipAddress: input.ipAddress,
      },
    });
    return { kind: "delivered" as const, invitation: delivered };
  });
  if (result.kind === "missing") {
    throw new BillingFoundationError("PILOT_INVITATION_NOT_FOUND", "Pilot invitation not found", 404);
  }
  if (result.kind === "expired") {
    throw new BillingFoundationError("PILOT_INVITATION_EXPIRED", "Expired invitation cannot be delivered", 410);
  }
  if (result.kind === "invalid_status") {
    throw new BillingFoundationError("PILOT_INVITATION_NOT_DELIVERABLE", "Pilot invitation cannot be marked delivered", 409);
  }
  return result.invitation;
}

export async function revokePilotInvitation(input: {
  invitationId: string;
  reason: string;
  administratorUserId: string;
  ipAddress?: string;
}) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.pilotInvitation.findUnique({ where: { id: input.invitationId } });
    if (!existing) return { kind: "missing" as const };
    await lockCampaignAndReconcile(tx, existing.campaignCode, now);
    const invitation = await tx.pilotInvitation.findUniqueOrThrow({ where: { id: existing.id } });
    if (invitation.status === "REVOKED") return { kind: "revoked" as const, invitation };
    if (invitation.status === "EXPIRED") {
      return { kind: "expired" as const };
    }
    const revoked = await tx.pilotInvitation.update({
      where: { id: invitation.id },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedByUserId: input.administratorUserId,
        revocationReason: input.reason,
      },
    });
    await tx.subscriptionOfferRedemption.updateMany({
      where: { invitationId: invitation.id, status: { in: ["RESERVED", "REDEEMED"] } },
      data: { status: "REVOKED", revokedAt: now },
    });
    await tx.pilotInvitationEvent.create({
      data: {
        invitationId: invitation.id,
        type: "REVOKED",
        actorUserId: input.administratorUserId,
        metadataJson: { reason: input.reason },
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_INVITATION_REVOKED",
        targetType: "PILOT_INVITATION",
        targetId: invitation.id,
        ipAddress: input.ipAddress,
        metadataJson: { reason: input.reason, redeemedAt: invitation.redeemedAt?.toISOString() ?? null },
      },
    });
    await tx.billingAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_INVITATION_REVOKED",
        targetType: "PILOT_INVITATION",
        targetId: invitation.id,
        provider: "PILOT",
        ipAddress: input.ipAddress,
        metadataJson: { reason: input.reason, redeemedAt: invitation.redeemedAt?.toISOString() ?? null },
      },
    });
    await lockCampaignAndReconcile(tx, invitation.campaignCode, now);
    return { kind: "revoked" as const, invitation: revoked };
  });
  if (result.kind === "missing") {
    throw new BillingFoundationError("PILOT_INVITATION_NOT_FOUND", "Pilot invitation not found", 404);
  }
  if (result.kind === "expired") {
    throw new BillingFoundationError("PILOT_INVITATION_EXPIRED", "Expired invitation cannot be revoked", 409);
  }
  return result.invitation;
}

export async function redeemPilotInvitation(input: {
  token: string;
  userId: string;
  userEmail: string;
  ipAddress?: string;
}) {
  const now = new Date();
  const tokenHash = hashPilotInvitationToken(input.token);
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.pilotInvitation.findUnique({ where: { tokenHash } });
    if (!initial) return { kind: "invalid" as const };
    await lockCampaignAndReconcile(tx, initial.campaignCode, now);
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PilotInvitation" WHERE "id" = ${initial.id} FOR UPDATE
    `;
    const invitation = await tx.pilotInvitation.findUniqueOrThrow({ where: { id: initial.id } });
    if (invitation.status === "EXPIRED" || invitation.expiresAt <= now) return { kind: "expired" as const };
    if (invitation.status === "REDEEMED") return { kind: "used" as const };
    if (invitation.status === "REVOKED") return { kind: "revoked" as const };
    if (!reservingInvitationStatuses.includes(invitation.status as (typeof reservingInvitationStatuses)[number])) {
      return { kind: "invalid" as const };
    }
    if (invitation.userId && invitation.userId !== input.userId) return { kind: "wrong_user" as const };
    if (normalizeEmail(invitation.email) !== normalizeEmail(input.userEmail)) return { kind: "wrong_user" as const };

    const existingOffer = await tx.subscriptionOfferRedemption.findUnique({
      where: { userId_eligibilityGroup: { userId: input.userId, eligibilityGroup: welcomeOfferGroup } },
    });
    if (existingOffer) return { kind: "offer_used" as const };

    const campaign = await tx.pilotCampaign.findUniqueOrThrow({ where: { code: invitation.campaignCode } });
    if (campaign.redeemedCount >= Math.min(campaign.redemptionLimit, env.pilotMaxRedemptions)) {
      return { kind: "full" as const };
    }

    const redeemed = await tx.pilotInvitation.update({
      where: { id: invitation.id },
      data: { status: "REDEEMED", userId: input.userId, redeemedByUserId: input.userId, redeemedAt: now },
    });
    const offer = await tx.subscriptionOfferRedemption.create({
      data: {
        userId: input.userId,
        eligibilityGroup: welcomeOfferGroup,
        offerKind: "PILOT_DISCOUNT",
        provider: "PILOT",
        status: "REDEEMED",
        invitationId: invitation.id,
        externalOfferId: campaign.code,
        reservedAt: invitation.approvedAt,
        redeemedAt: now,
        metadataJson: { discountMonths: env.pilotDiscountMonths },
      },
    });
    await tx.pilotInvitationEvent.create({
      data: { invitationId: invitation.id, type: "REDEEMED", actorUserId: input.userId },
    });
    await tx.billingAuditLog.create({
      data: {
        actorUserId: input.userId,
        action: "PILOT_INVITATION_REDEEMED",
        targetType: "PILOT_INVITATION",
        targetId: invitation.id,
        provider: "PILOT",
        ipAddress: input.ipAddress,
        metadataJson: { campaignCode: campaign.code, offerRedemptionId: offer.id },
      },
    });
    const reconciled = await lockCampaignAndReconcile(tx, campaign.code, now);
    return { kind: "redeemed" as const, invitation: redeemed, offer, campaign: reconciled };
  });

  switch (result.kind) {
    case "redeemed": return result;
    case "expired": throw new BillingFoundationError("PILOT_INVITATION_EXPIRED", "Pilot invitation has expired", 410);
    case "used": throw new BillingFoundationError("PILOT_INVITATION_USED", "Pilot invitation was already redeemed", 409);
    case "revoked": throw new BillingFoundationError("PILOT_INVITATION_REVOKED", "Pilot invitation was revoked", 409);
    case "wrong_user": throw new BillingFoundationError("PILOT_INVITATION_NOT_ASSIGNED", "Pilot invitation is assigned to another account", 403);
    case "offer_used": throw new BillingFoundationError("WELCOME_OFFER_ALREADY_USED", "This account has already used a non-stackable offer", 409);
    case "full": throw new BillingFoundationError("PILOT_CAPACITY_REACHED", "The 100-driver pilot is full", 409);
    default: throw new BillingFoundationError("INVALID_PILOT_INVITATION", "Pilot invitation is invalid", 404);
  }
}

export async function updatePilotCampaignStatus(input: {
  campaignCode: string;
  status: PilotCampaignStatus;
  administratorUserId: string;
  reason: string;
  ipAddress?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.pilotCampaign.findUnique({ where: { code: input.campaignCode } });
    if (!campaign) throw new BillingFoundationError("PILOT_CAMPAIGN_NOT_FOUND", "Pilot campaign not found", 404);
    const updated = await tx.pilotCampaign.update({ where: { code: campaign.code }, data: { status: input.status } });
    await tx.adminAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_CAMPAIGN_STATUS_UPDATED",
        targetType: "PILOT_CAMPAIGN",
        targetId: campaign.code,
        ipAddress: input.ipAddress,
        metadataJson: { previousStatus: campaign.status, status: input.status, reason: input.reason },
      },
    });
    await tx.billingAuditLog.create({
      data: {
        actorUserId: input.administratorUserId,
        action: "PILOT_CAMPAIGN_STATUS_UPDATED",
        targetType: "PILOT_CAMPAIGN",
        targetId: campaign.code,
        provider: "PILOT",
        ipAddress: input.ipAddress,
        metadataJson: { previousStatus: campaign.status, status: input.status, reason: input.reason },
      },
    });
    return updated;
  });
}

export async function listPilotInvitations() {
  return prisma.$transaction(async (tx) => {
    const campaign = await lockCampaignAndReconcile(tx, env.pilotCampaignCode, new Date());
    const invitations = await tx.pilotInvitation.findMany({
      where: { campaignCode: campaign.code },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        campaignCode: true,
        email: true,
        userId: true,
        status: true,
        expiresAt: true,
        approvedByUserId: true,
        approvedAt: true,
        deliveredByUserId: true,
        deliveredAt: true,
        redeemedByUserId: true,
        redeemedAt: true,
        revokedByUserId: true,
        revokedAt: true,
        revocationReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { campaign, invitations, available: availableConfiguredPilotSlots(campaign) };
  });
}
