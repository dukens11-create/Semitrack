import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { RecoveryOutbox, recoveryOutboxKey, sealRecoveryJob, openRecoveryJob } from '../dist/services/recoveryOutbox.js';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';
const key = randomBytes(32);
const config = { apiKey: 're_synthetic_test', from: 'reset@example.test', resetBaseUrl: 'https://www.semitrax.com/reset-password.html' };
let disconnect: (() => Promise<void>) | undefined;
after(async () => { await disconnect?.(); });
test('durable recovery configuration is optional, validates without echoing the key', () => {
  assert.equal(recoveryOutboxKey(undefined), null);
  assert.deepEqual(recoveryOutboxKey(key.toString('hex')), key);
  assert.throws(() => recoveryOutboxKey('private-invalid-value'), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('private-invalid-value'));
    return true;
  });
});
test('outbox encrypts recipient and credential, authenticates job identity and refuses tampering', () => {
  const id = randomUUID(), input = { email: 'private-driver@example.test', token: randomBytes(48).toString('base64url'), expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  const encrypted = sealRecoveryJob(key, id, input);
  assert.ok(!encrypted.includes(input.email)); assert.ok(!encrypted.includes(input.token));
  assert.deepEqual(openRecoveryJob(key, id, encrypted), input);
  assert.notEqual(sealRecoveryJob(key, id, input), encrypted);
  for (const action of [() => openRecoveryJob(key, 'other-job', encrypted), () => openRecoveryJob(randomBytes(32), id, encrypted), () => openRecoveryJob(key, id, encrypted.slice(0, -8) + 'tampered')]) {
    assert.throws(action, /^Error: RECOVERY_JOB_INVALID$/);
  }
});
async function fixture() {
  process.env.DATABASE_URL = requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
  const { prisma, disconnectDatabase } = await import('../dist/lib/prisma.js'); disconnect = disconnectDatabase;
  await prisma.$executeRaw`DELETE FROM "RecoveryDeliveryJob"`;
  const user = await prisma.user.create({ data: { email: randomUUID() + '@example.test', fullName: 'Isolated recovery test', passwordHash: 'not-a-login' } });
  const cleanup = async () => { await prisma.$executeRaw`DELETE FROM "RecoveryDeliveryJob"`; await prisma.user.delete({ where: { id: user.id } }); };
  const count = async () => Number((await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "RecoveryDeliveryJob"`)[0]!.count);
  return { prisma, user, cleanup, count };
}
const local = { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL };

test('PG16 crashed-worker lease expires; corrupt ciphertext never reaches delivery', local, async () => {
  const { prisma, user, cleanup, count } = await fixture();
  try {
    let sends = 0, failures = 0;
    const worker = new RecoveryOutbox(prisma, key, config, () => { failures++; }, async () => { sends++; });
    await worker.enqueue(user.email);
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "attempts" = 1, "leaseToken" = 'synthetic-dead-worker', "leaseUntil" = NOW() + INTERVAL '1 minute'`;
    assert.equal(await worker.runOne(), false);
    assert.equal(sends, 0);
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "leaseUntil" = NOW() - INTERVAL '1 second'`;
    assert.equal(await worker.runOne(), true);
    assert.equal(sends, 1); assert.equal(await count(), 0);
    await worker.enqueue(user.email);
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "payload" = 'invalid-ciphertext'`;
    await worker.runOne();
    assert.equal(sends, 1); assert.equal(failures, 1);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 1);
  } finally { await cleanup(); }
});
test('PG16 admission survives process object restart; retry reuses one credential and one reset record', local, async () => {
  const { prisma, user, cleanup, count } = await fixture();
  try {
    const admitted = new RecoveryOutbox(prisma, key, config, () => {}, async () => { throw Error('must not send on admission'); });
    assert.equal(await admitted.enqueue(user.email), true);
    const raw = await prisma.$queryRaw<{ payload: string }[]>`SELECT "payload" FROM "RecoveryDeliveryJob"`;
    assert.ok(!raw[0]!.payload.includes(user.email));
    const received: string[] = [];
    const worker = new RecoveryOutbox(prisma, key, config, () => {}, async (_config, _email, token) => { received.push(token); throw Error('synthetic timeout'); });
    assert.equal(await worker.runOne(), true);
    assert.equal(await count(), 1);
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "availableAt" = NOW()`;
    const restarted = new RecoveryOutbox(prisma, key, config, () => {}, async (_config, email, token) => { assert.equal(email, user.email); received.push(token); });
    assert.equal(await restarted.runOne(), true);
    assert.equal(received.length, 2); assert.equal(received[0], received[1]);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 1);
    assert.equal(await count(), 0);
  } finally { await cleanup(); }
});
test('PG16 separate workers lease a job once and legacy unknown/disabled accounts disclose nothing', local, async () => {
  const { prisma, user, cleanup, count } = await fixture();
  try {
    let sends = 0;
    const deliver = async () => { sends++; };
    const a = new RecoveryOutbox(prisma, key, config, () => {}, deliver), b = new RecoveryOutbox(prisma, key, config, () => {}, deliver);
    await a.enqueue(user.email);
    const results = await Promise.all([a.runOne(), b.runOne()]);
    assert.equal(results.filter(Boolean).length, 1); assert.equal(sends, 1);
    assert.equal(await a.enqueue(randomUUID() + '@example.test'), true);
    await a.runOne(); assert.equal(sends, 1);
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    await a.enqueue(user.email); await a.runOne(); assert.equal(sends, 1);
    assert.equal(await count(), 0);
  } finally { await cleanup(); }
});
test('PG16 bounded admission is atomic; expired jobs are removed without delivery', local, async () => {
  const { prisma, user, cleanup, count } = await fixture();
  try {
    let sends = 0;
    const worker = new RecoveryOutbox(prisma, key, config, () => {}, async () => { sends++; });
    const accepted = await Promise.all(Array.from({ length: 24 }, () => worker.enqueue(user.email)));
    assert.equal(accepted.filter(Boolean).length, 20); assert.equal(await count(), 20);
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "expiresAt" = NOW() - INTERVAL '1 second'`;
    assert.equal(await worker.runOne(), false); assert.equal(await count(), 0); assert.equal(sends, 0);
  } finally { await cleanup(); }
});
test('PG16 exhausted retries are removed and used reset tokens are not delivered again', local, async () => {
  const { prisma, user, cleanup, count } = await fixture();
  try {
    let failures = 0;
    const worker = new RecoveryOutbox(prisma, key, config, () => { failures++; }, async () => { throw Error('synthetic'); });
    await worker.enqueue(user.email);
    for (let i = 0; i < 3; i++) { await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "availableAt" = NOW()`; await worker.runOne(); }
    assert.equal(failures, 3); assert.equal(await count(), 0);
    await worker.enqueue(user.email); await worker.runOne();
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { usedAt: new Date() } });
    await prisma.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "availableAt" = NOW()`;
    await worker.runOne(); assert.equal(failures, 4); assert.equal(await count(), 0);
  } finally { await cleanup(); }
});

test('production cannot silently fall back to non-durable recovery admission',()=>{
 for(const missing of [undefined,'','  '])assert.throws(()=>recoveryOutboxKey(missing,true),/required for durable production/);
 assert.deepEqual(recoveryOutboxKey(key.toString('hex'),true),key);
 assert.throws(()=>recoveryOutboxKey('private-invalid-value',true),error=>!error.message.includes('private-invalid-value'));
});
