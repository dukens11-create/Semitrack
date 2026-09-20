import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { comparePassword } from '../utils/password.js';
import { deny } from '../modules/admin/operationalPolicy.js';

export const deletionInput = z.object({
  currentPassword: z.string().min(1).max(128),
  confirmation: z.literal('DELETE MY ACCOUNT'),
}).strict();
const ledgerSchema = z.array(z.object({
  userId: z.string().min(1).max(200),
  deletedAt: z.string().datetime(),
}).strict()).max(10000);
type Tombstone = {userId: string; deletedAt: Date};

async function minimize(tx: Prisma.TransactionClient, userId: string, deletedAt: Date) {
  // Trigger sanitizes the principal and prevents later administrative reactivation.
  await tx.user.updateMany({where:{id:userId},data:{disabledAt:deletedAt}});
  await tx.refreshToken.updateMany({where:{userId,revokedAt:null},data:{revokedAt:deletedAt}});
  await tx.passwordResetToken.updateMany({where:{userId,usedAt:null},data:{usedAt:deletedAt}});
  await tx.eldOAuthState.deleteMany({where:{userId}});
  await tx.eldConnection.updateMany({where:{userId},data:{
    encryptedAccessToken:null,encryptedRefreshToken:null,accessTokenExpiresAt:null,
    providerAccountId:null,scopes:[],status:'DISCONNECTED',lastErrorCode:null,lastErrorMessage:null,
    revision:{increment:1},
  }});
  await tx.navigationSettings.deleteMany({where:{userId}});
  await tx.favorite.deleteMany({where:{userId}});
  // Compliance/trip/truck documents and any actual file reference remain on hold.
  await tx.document.deleteMany({where:{userId,type:'GENERAL',truckId:null,fileUrl:''}});
  // Retained records reference an anonymized principal, not a usable account.
}
export async function deleteOwnAccount(db: PrismaClient, userId: string, raw: unknown) {
  const input = deletionInput.parse(raw);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const prior = await tx.$queryRaw<Tombstone[]>`SELECT "userId","deletedAt" FROM "AccountDeletionTombstone" WHERE "userId" = ${userId}`;
    if (prior.length) return {deleted:true,retention:'POLICY_REQUIRED' as const};
    const user = await tx.user.findUnique({where:{id:userId},include:{staffAccess:true}});
    if (!user || user.disabledAt || !await comparePassword(input.currentPassword,user.passwordHash))
      deny('CURRENT_PASSWORD_INVALID',400);
    if (user.role !== 'DRIVER' || user.staffAccess) deny('ACCOUNT_DELETION_REVIEW_REQUIRED',409);
    if (await tx.fleetMembership.findFirst({where:{userId,unassignedAt:null,role:{not:'DRIVER'}}}))
      deny('ACCOUNT_DELETION_REVIEW_REQUIRED',409);
    const deletedAt = new Date();
    await tx.$executeRaw`INSERT INTO "AccountDeletionTombstone" ("userId","deletedAt") VALUES (${userId},${deletedAt})`;
    await minimize(tx,userId,deletedAt);
    return {deleted:true,retention:'POLICY_REQUIRED' as const};
  });
}
/** Operator-only restore step. Never exposed through a public endpoint.
 * Input must be the separately preserved access-controlled deletion ledger.
 * Immutable backups are not modified; no retention expiration is inferred.
 */
export async function reapplyDeletionLedger(db: PrismaClient, input: unknown) {
  const rows = ledgerSchema.parse(input);
  await db.$transaction(async tx => {
    for (const row of [...rows].sort((a,b)=>a.userId.localeCompare(b.userId))) {
      const deletedAt=new Date(row.deletedAt);
      if(deletedAt>new Date())throw new Error('DELETION_LEDGER_INVALID');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${row.userId} FOR UPDATE`;
      await tx.$executeRaw`INSERT INTO "AccountDeletionTombstone" ("userId","deletedAt") VALUES (${row.userId},${deletedAt}) ON CONFLICT ("userId") DO NOTHING`;
      await minimize(tx,row.userId,deletedAt);
    }
  });
  return {applied:rows.length};
}
