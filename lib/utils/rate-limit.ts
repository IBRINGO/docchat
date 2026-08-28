interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Best-effort, single-process, in-memory fixed-window rate limiter.
 *
 * NOT a distributed limiter: `buckets` is a module-level Map, so each
 * serverless instance (Vercel, or any horizontally-scaled deployment) keeps
 * its own counters with no shared state. This bounds abuse against one warm
 * instance — useful for a single long-lived dev/server process — but a
 * client hitting a fresh instance, or requests spread across instances,
 * bypass it entirely. A production deployment needing real, cross-instance
 * limits should replace this with a shared store (e.g. Upstash Redis).
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
