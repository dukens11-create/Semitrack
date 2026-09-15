import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { comparePassword, hashPassword } from "../../utils/password.js";
import { adminAccountUpdateSchema } from "./adminAccountValidation.js";

export const adminAccountRouter = Router();

adminAccountRouter.patch("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const input = adminAccountUpdateSchema.parse(req.body);
    const userId = req.user!.userId;
    const current = await prisma.user.findUnique({ where: { id: userId } });
    if (!current || current.disabledAt || current.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "Administrator access is required" } });
    }
    if (!(await comparePassword(input.currentPassword, current.passwordHash))) {
      return res.status(400).json({ error: { code: "CURRENT_PASSWORD_INVALID", message: "Current password is incorrect" } });
    }

    if (input.email && input.email !== current.email) {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "That email is already in use" } });
      }
    }
    if (input.newPassword && await comparePassword(input.newPassword, current.passwordHash)) {
      return res.status(400).json({ error: { code: "PASSWORD_UNCHANGED", message: "Choose a new password that is different from the current password" } });
    }

    const passwordChanged = Boolean(input.newPassword);
    const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const changed=await tx.user.updateMany({where:{id:userId,passwordHash:current.passwordHash,disabledAt:null,role:'ADMIN'},data:{fullName:input.fullName,email:input.email,passwordHash}});
      if(changed.count!==1)throw Object.assign(new Error('Account changed; sign in and review again.'),{safeCode:'ACCOUNT_CHANGED',safeStatus:409});
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          plan: true,
          emailVerified: true,
        },
      });
      if (passwordChanged) {
        await tx.passwordResetToken.updateMany({where:{userId,usedAt:null},data:{usedAt:new Date()}});
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.adminAuditLog.create({
        data: {
          actorUserId: userId,
          action: "ADMIN_ACCOUNT_UPDATED",
          targetType: "USER",
          targetId: userId,
          ipAddress: req.ip,
          metadataJson: {
            emailChanged: input.email !== undefined && input.email !== current.email,
            nameChanged: input.fullName !== undefined && input.fullName !== current.fullName,
            passwordChanged,
          },
        },
      });
      return user;
    });

    res.json({ user: updated, passwordChanged });
  } catch (error) {
    next(error);
  }
});
