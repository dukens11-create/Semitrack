import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, comparePassword } from '../utils/password.js';
import { deny } from '../modules/admin/operationalPolicy.js';
import type { PrismaClient } from '@prisma/client';
import type { RecoveryConfiguration } from '../config/recoveryConfig.js';
import { sendRecoveryEmail } from './recoveryEmail.js';

export async function requestPasswordRecovery(
  db: Pick<PrismaClient, 'user' | 'passwordResetToken'>,
  config: RecoveryConfiguration,
  email: string,
  reportFailure: () => void,
  deliver = sendRecoveryEmail,
) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.disabledAt) return;
  const token = randomBytes(48).toString('base64url');
  const record = await db.passwordResetToken.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 3_600_000),
  } });
  // Requesting a reset must not invalidate an earlier usable link or a working session.
  try { await deliver(config, user.email, token); }
  catch {
    reportFailure();
    // Keep provider/account details out of the public response. Invalidate only this failed delivery.
    await db.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  }
}

/** Serialize password replacement and session issuance on the same owner row. */
export async function confirmPasswordRecovery(db:PrismaClient,token:string,password:string){
 const tokenHash=createHash('sha256').update(token).digest('hex');
 const record=await db.passwordResetToken.findUnique({where:{tokenHash}});
 if(!record||record.usedAt||record.expiresAt<=new Date())return false;
 const passwordHash=await hashPassword(password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${record.userId} FOR UPDATE`;
  const user=await tx.user.findUnique({where:{id:record.userId}});if(!user||user.disabledAt)return false;
  const claimed=await tx.passwordResetToken.updateMany({where:{id:record.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
  if(claimed.count!==1)return false;
  await tx.user.update({where:{id:user.id},data:{passwordHash}});
  await tx.passwordResetToken.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:new Date()}});
  await tx.refreshToken.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
  return true;
 });
}
export async function changeUserPassword(db:PrismaClient,userId:string,currentPassword:string,password:string){
 const passwordHash=await hashPassword(password);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user=await tx.user.findUnique({where:{id:userId}});
  if(!user||user.disabledAt||!await comparePassword(currentPassword,user.passwordHash))deny('CURRENT_PASSWORD_INVALID',400);
  await tx.user.update({where:{id:userId},data:{passwordHash}});
  await tx.passwordResetToken.updateMany({where:{userId,usedAt:null},data:{usedAt:new Date()}});
  await tx.refreshToken.updateMany({where:{userId,revokedAt:null},data:{revokedAt:new Date()}});
 });
}
