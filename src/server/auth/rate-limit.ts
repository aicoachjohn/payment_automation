/**
 * Fixed-window in-memory rate limiter (FR-SEC-07) for login, forgot-password and OTP
 * endpoints, to blunt brute-force and enumeration.
 *
 * In-memory is sufficient for a single-node deployment; it resets on restart. A
 * multi-node deployment should back this with a shared store (Redis) — noted for
 * Phase 12. This is defence-in-depth on top of per-account lockout.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Consume one unit for `key`. Returns whether it is allowed and, if not, how long until
 * the window resets. `now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (bucket.count >= opts.limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Test/support helper: clear all limiter state. */
export function resetRateLimiter(): void {
  buckets.clear();
}
