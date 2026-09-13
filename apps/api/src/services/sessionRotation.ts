import type { PrismaClient, Prisma, User } from '@prisma/client';
/** Consume the old credential and issue its replacement in one database transaction. */
export async function rotateRefreshSession<T>(db: PrismaClient, tokenHash: string, issue: (user: User, tx: Prisma.TransactionClient) => Promise<T>): Promise<T|null> {
  return db.$transaction(async tx => {
    const record = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!record || record.revokedAt || record.expiresAt <= new Date() || record.user.disabledAt) return null;
    const claim = await tx.refreshToken.updateMany({ where: { id: record.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (claim.count !== 1) return null;
    return issue(record.user, tx);
  });
}
