import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';
let disconnect: (() => Promise<void>) | undefined;
after(async () => { await disconnect?.(); });
test('concurrent same-owner community reports admit exactly once; other owners and expired window stay independent',
  { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL }, async () => {
    process.env.DATABASE_URL = requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
    const { prisma, disconnectDatabase } = await import('../dist/lib/prisma.js');
    disconnect = disconnectDatabase;
    const { admitCommunityReport } = await import('../dist/services/communityReportAdmission.js');
    const user = await prisma.user.create({ data: { email: randomUUID() + '@fixture.invalid', fullName: 'Local test', passwordHash: 'not-a-login', reportTrustScore: 0.4 } });
    const other = await prisma.user.create({ data: { email: randomUUID() + '@fixture.invalid', fullName: 'Other local test', passwordHash: 'not-a-login' } });
    try {
      const input = { type: 'ROAD_CONDITION' as const, entityId: randomUUID(), value: 'SYNTHETIC', expiresAt: new Date(Date.now() + 3600_000) };
      const results = await Promise.all(Array.from({ length: 5 }, () => admitCommunityReport(prisma, user.id, input)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await prisma.communityDataReport.count({ where: { userId: user.id } }), 1);
      assert.equal(results.find(Boolean)!.confidence, 0.4);
      assert.ok(await admitCommunityReport(prisma, other.id, input));
      await prisma.communityDataReport.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 121_000) } });
      assert.ok(await admitCommunityReport(prisma, user.id, input));
      await prisma.user.update({ where: { id: other.id }, data: { disabledAt: new Date() } });
      assert.equal(await admitCommunityReport(prisma, other.id, { ...input, entityId: randomUUID() }), null);
    } finally { await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } }); }
  });
