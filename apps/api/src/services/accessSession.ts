import type { PrismaClient } from '@prisma/client';
import type { AuthTokenPayload } from '../utils/jwt.js';
/** An access JWT is usable only while its exact refresh-session row remains active. */
export async function currentAccessSession(db: Pick<PrismaClient, 'refreshToken'>, claims: AuthTokenPayload) {
  if (!claims.sessionId) return null;
  const session = await db.refreshToken.findFirst({
    where: { id: claims.sessionId, userId: claims.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, email: true, role: true, disabledAt: true } } },
  });
  return session && !session.user.disabledAt ? session.user : null;
}
