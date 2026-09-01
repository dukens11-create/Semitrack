import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireTestBillingMode } from "./billingMode.middleware.js";
import {
  approvePilotInvitation,
  listPilotInvitations,
  markPilotInvitationDelivered,
  redeemPilotInvitation,
  revokePilotInvitation,
  updatePilotCampaignStatus,
} from "./pilot.service.js";

export const pilotRouter = Router();
export const adminPilotRouter = Router();

const redeemSchema = z.object({ token: z.string().trim().min(32).max(256) }).strict();

pilotRouter.post(
  "/invitations/redeem",
  requireAuth,
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = redeemSchema.parse(req.body);
      const result = await redeemPilotInvitation({
        token: input.token,
        userId: req.user!.userId,
        userEmail: req.user!.email,
        ipAddress: req.ip,
      });
      res.json({
        pilot: {
          campaignCode: result.campaign.code,
          invitationId: result.invitation.id,
          offerStatus: result.offer.status,
          discountMonths: env.pilotDiscountMonths,
          monthlyPriceCents: result.campaign.monthlyPriceCents,
          regularMonthlyPriceCents: result.campaign.regularMonthlyPriceCents,
          entitlementActive: false,
          nextStep: "Complete a verified pilot subscription with an approved billing provider when store billing is enabled.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

pilotRouter.get("/eligibility", requireAuth, async (req, res, next) => {
  try {
    const [offer, invitation] = await Promise.all([
      prisma.subscriptionOfferRedemption.findUnique({
        where: { userId_eligibilityGroup: { userId: req.user!.userId, eligibilityGroup: "WELCOME_OFFER" } },
        select: { offerKind: true, provider: true, status: true, redeemedAt: true, revokedAt: true },
      }),
      prisma.pilotInvitation.findFirst({
        where: {
          campaignCode: env.pilotCampaignCode,
          OR: [{ userId: req.user!.userId }, { email: req.user!.email.toLowerCase() }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, expiresAt: true, deliveredAt: true, redeemedAt: true, revokedAt: true },
      }),
    ]);
    res.setHeader("cache-control", "private, no-store");
    res.json({ invitation, offer, canStackAnotherWelcomeOffer: false });
  } catch (error) {
    next(error);
  }
});

const approvalSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  userId: z.string().trim().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
}).strict();

adminPilotRouter.post(
  "/invitations",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = approvalSchema.parse(req.body);
      const result = await approvePilotInvitation({
        ...input,
        administratorUserId: req.user!.userId,
        ipAddress: req.ip,
      });
      const { tokenHash: _tokenHash, ...invitation } = result.invitation;
      res.status(201).json({
        invitation,
        invitationToken: result.token,
        tokenDisclosure: "This token is shown once. Deliver it securely; only its SHA-256 hash is stored.",
      });
    } catch (error) {
      next(error);
    }
  },
);

adminPilotRouter.post(
  "/invitations/:id/delivered",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const invitation = await markPilotInvitationDelivered({
        invitationId: String(req.params.id),
        administratorUserId: req.user!.userId,
        ipAddress: req.ip,
      });
      const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
      res.json({ invitation: safeInvitation });
    } catch (error) {
      next(error);
    }
  },
);

const revokeSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

adminPilotRouter.post(
  "/invitations/:id/revoke",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = revokeSchema.parse(req.body);
      const invitation = await revokePilotInvitation({
        invitationId: String(req.params.id),
        reason: input.reason,
        administratorUserId: req.user!.userId,
        ipAddress: req.ip,
      });
      const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
      res.json({ invitation: safeInvitation });
    } catch (error) {
      next(error);
    }
  },
);

const campaignStatusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]),
  reason: z.string().trim().min(5).max(500),
}).strict();

adminPilotRouter.patch(
  "/campaigns/:code",
  requireAuth,
  requireRole(["ADMIN"]),
  requireTestBillingMode,
  async (req, res, next) => {
    try {
      const input = campaignStatusSchema.parse(req.body);
      const campaign = await updatePilotCampaignStatus({
        campaignCode: String(req.params.code),
        status: input.status,
        reason: input.reason,
        administratorUserId: req.user!.userId,
        ipAddress: req.ip,
      });
      res.json({ campaign });
    } catch (error) {
      next(error);
    }
  },
);

adminPilotRouter.get(
  "/invitations",
  requireAuth,
  requireRole(["ADMIN"]),
  async (_req, res, next) => {
    try {
      res.setHeader("cache-control", "private, no-store");
      res.json(await listPilotInvitations());
    } catch (error) {
      next(error);
    }
  },
);
