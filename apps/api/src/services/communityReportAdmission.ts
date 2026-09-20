import type { Prisma, PrismaClient } from '@prisma/client';

type Input = Pick<Prisma.CommunityDataReportUncheckedCreateInput,
  'type' | 'entityId' | 'value' | 'numericValue' | 'latitude' | 'longitude' | 'note' | 'sourceContextJson' | 'expiresAt'>;

/** The authenticated owner lock serializes duplicate admission across API processes.
 * Caller still performs category, entity, proximity and spam validation first.
 */
export async function admitCommunityReport(db: PrismaClient, userId: string, input: Input) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const reporter = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { disabledAt: true, reportTrustScore: true } });
    if (reporter.disabledAt) return null;
    const duplicate = await tx.communityDataReport.findFirst({ where: {
      userId, type: input.type, entityId: input.entityId,
      createdAt: { gt: new Date(Date.now() - 120_000) },
    } });
    if (duplicate) return null;
    return tx.communityDataReport.create({ data: { ...input, userId, confidence: reporter.reportTrustScore } });
  });
}
