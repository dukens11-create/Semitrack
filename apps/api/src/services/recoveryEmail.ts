import { createHash } from 'node:crypto';
import type { RecoveryConfiguration } from '../config/recoveryConfig.js';

export class RecoveryDeliveryError extends Error {
  constructor() { super('RECOVERY_DELIVERY_FAILED'); }
}

/** Provider errors/bodies and recipient/token values must never enter application logs. */
export async function sendRecoveryEmail(config: RecoveryConfiguration, email: string, token: string,
  request: typeof fetch = fetch) {
  const link = new URL(config.resetBaseUrl);
  // The browser fragment avoids sending the credential to website access logs/referrers.
  link.hash = new URLSearchParams({ token }).toString();
  try {
    const response = await request('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `password-reset/${createHash('sha256').update(token).digest('hex')}`,
      },
      body: JSON.stringify({
        from: config.from, to: [email], subject: 'Reset your SemiTraX password',
        text: `Use this link to choose a new SemiTraX password:\n\n${link.href}\n\nThis link expires in one hour and can be used once. If you did not request a reset, ignore this email.`,
      }),
    });
    // Resend success acknowledges acceptance, not inbox delivery. No body data is needed.
    await response.body?.cancel();
    if (!response.ok) throw new RecoveryDeliveryError();
  } catch {
    throw new RecoveryDeliveryError();
  }
}
