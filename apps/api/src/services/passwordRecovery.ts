import { createHash, randomBytes } from 'node:crypto';
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
