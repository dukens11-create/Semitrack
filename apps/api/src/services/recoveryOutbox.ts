import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { RecoveryConfiguration } from '../config/recoveryConfig.js';
import { sendRecoveryEmail } from './recoveryEmail.js';

const payloadSchema = z.object({ email: z.string().email().max(254), token: z.string().regex(/^[A-Za-z0-9_-]{64}$/), expiresAt: z.string().datetime() }).strict();
type Payload = z.infer<typeof payloadSchema>;
type Job = { id: string; payload: string; attempts: number; expiresAt: Date; leaseToken: string };
export function recoveryOutboxKey(value: string | undefined, required = false): Buffer | null {
  if (!value?.trim()) {
    if (required) throw new Error('PASSWORD_RECOVERY_OUTBOX_KEY is required for durable production password recovery');
    return null;
  }
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('PASSWORD_RECOVERY_OUTBOX_KEY must be 32 bytes encoded as hex');
  return Buffer.from(value, 'hex');
}
export function sealRecoveryJob(key: Buffer, id: string, payload: Payload): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('semitrax-recovery-v1:' + id));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payloadSchema.parse(payload)), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function openRecoveryJob(key: Buffer, id: string, value: string): Payload {
  try {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || value.length > 4096) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'base64url'));
    decipher.setAAD(Buffer.from('semitrax-recovery-v1:' + id));
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
    return payloadSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8')));
  } catch { throw new Error('RECOVERY_JOB_INVALID'); }
}

/** PostgreSQL leases survive API restarts; all recipients get identical admission.
 * Address/token are encrypted, delivery uses the same token/idempotency key on retry.
 */
export class RecoveryOutbox {
  private timer?: ReturnType<typeof setInterval>;
  private flight?: Promise<boolean>;
  constructor(private db: PrismaClient, private key: Buffer,
    private config: RecoveryConfiguration, private reportFailure: () => void,
    private deliver = sendRecoveryEmail) {}
  async enqueue(email: string): Promise<boolean> {
    const id = randomUUID(), expiresAt = new Date(Date.now() + 3600_000);
    const payload = sealRecoveryJob(this.key, id, { email: email.trim().toLowerCase(), token: randomBytes(48).toString('base64url'), expiresAt: expiresAt.toISOString() });
    return this.db.$transaction(async tx => {
      // Global bounded admission across instances; never locks by account existence.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(173204891, 1)`;
      await tx.$executeRaw`DELETE FROM "RecoveryDeliveryJob" WHERE "expiresAt" <= NOW() OR ("attempts" >= 3 AND "leaseUntil" < NOW())`;
      const count = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "RecoveryDeliveryJob"`;
      if (Number(count[0]!.count) >= 20) return false;
      await tx.$executeRaw`INSERT INTO "RecoveryDeliveryJob" ("id", "payload", "expiresAt") VALUES (${id}, ${payload}, ${expiresAt})`;
      return true;
    });
  }
  runOne(): Promise<boolean> {
    if (this.flight) return this.flight;
    const task = this.process().finally(() => { if (this.flight === task) this.flight = undefined; });
    this.flight = task;
    return task;
  }
  private async process(): Promise<boolean> {
    await this.db.$executeRaw`DELETE FROM "RecoveryDeliveryJob" WHERE "expiresAt" <= NOW() OR ("attempts" >= 3 AND "leaseUntil" < NOW())`;
    const lease = randomUUID();
    const jobs = await this.db.$queryRaw<Job[]>`
      WITH candidate AS (
        SELECT "id" FROM "RecoveryDeliveryJob"
        WHERE "availableAt" <= NOW() AND "expiresAt" > NOW() AND "attempts" < 3
          AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "RecoveryDeliveryJob" AS job SET "attempts" = "attempts" + 1,
        "leaseToken" = ${lease}, "leaseUntil" = NOW() + INTERVAL '2 minutes'
      FROM candidate WHERE job."id" = candidate."id" RETURNING job.*`;
    const job = jobs[0];
    if (!job) return false;
    try {
      const payload = openRecoveryJob(this.key, job.id, job.payload);
      if (new Date(payload.expiresAt).getTime() !== job.expiresAt.getTime()) throw new Error('RECOVERY_JOB_INVALID');
      const user = await this.db.user.findUnique({ where: { email: payload.email } });
      if (user && !user.disabledAt) {
        const tokenHash = createHash('sha256').update(payload.token).digest('hex');
        const token = await this.db.passwordResetToken.upsert({ where: { tokenHash },
          create: { userId: user.id, tokenHash, expiresAt: job.expiresAt }, update: {} });
        if (token.userId === user.id && !token.usedAt && token.expiresAt > new Date()) await this.deliver(this.config, user.email, payload.token);
      }
      await this.db.$executeRaw`DELETE FROM "RecoveryDeliveryJob" WHERE "id" = ${job.id} AND "leaseToken" = ${lease}`;
    } catch {
      try { this.reportFailure(); } catch { /* Never log recipient, token, payload or upstream errors. */ }
      if (job.attempts >= 3) {
        await this.db.$executeRaw`DELETE FROM "RecoveryDeliveryJob" WHERE "id" = ${job.id} AND "leaseToken" = ${lease}`;
      } else {
        const retry = new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1));
        await this.db.$executeRaw`UPDATE "RecoveryDeliveryJob" SET "availableAt" = ${retry}, "leaseUntil" = NULL, "leaseToken" = NULL WHERE "id" = ${job.id} AND "leaseToken" = ${lease}`;
      }
    }
    return true;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runOne().catch(() => { try { this.reportFailure(); } catch {} }); }, 1000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flight;
  }
}
