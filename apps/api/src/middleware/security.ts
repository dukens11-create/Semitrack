import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
/** Bounded per-process limiter; unknown/full buckets fail closed rather than evict active limits. */
export function createRateLimiter(limit: number, windowMs: number, maxBuckets = 10000, clock = Date.now) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    const key = req.ip ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxBuckets) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Please wait and try again.' } });
      bucket = { count: 0, resetAt: now + windowMs }; buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > limit) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Please wait and try again.' } });
    }
    next();
  };
}
export function requestMetadata(req: Request, res: Response, next: NextFunction) {
  // Ignore caller-provided identifiers, which may contain private data or forged log content.
  const requestId = randomUUID(); res.setHeader('x-request-id', requestId);
  const started = Date.now();
  res.on('finish', () => console.info(JSON.stringify({ event: 'HTTP_REQUEST', requestId,
    method: ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(req.method) ? req.method : 'OTHER',
    status: res.statusCode, durationMs: Date.now() - started })));
  next();
}
export function logServerEvent(event: 'INTERNAL_ERROR' | 'DATABASE_UNAVAILABLE' | 'PROVIDER_FAILURE' | 'ELD_REVOKE_FAILED' | 'DOT_REFRESH_FAILED' | 'RECOVERY_DELIVERY_FAILED') {
  console.error(JSON.stringify({ event }));
}
