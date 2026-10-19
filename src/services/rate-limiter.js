/**
 * rate-limiter.js — Token-bucket rate limiter for per-user and per-group limits.
 *
 * Provides pre-configured limiters for AI, media downloads, and image search.
 * Each limiter tracks usage per key (usually sender JID) with automatic cleanup.
 */

/**
 * Create a token-bucket rate limiter.
 *
 * @param {object} opts
 * @param {number} opts.maxTokens       - Requests allowed per window
 * @param {number} opts.windowMs        - Window duration in milliseconds
 * @param {number} opts.cleanupIntervalMs - Interval to prune expired buckets
 * @returns {object} Limiter with check(), reset(), stats(), destroy() methods
 */
export function createRateLimiter({
  maxTokens = 10,
  windowMs = 60_000,
  cleanupIntervalMs = 300_000,
} = {}) {
  /** @type {Map<string, { tokens: number, windowStart: number, lastUsed: number }>} */
  const buckets = new Map();

  // Periodic cleanup of stale buckets — does not prevent process exit
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastUsed > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, cleanupIntervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return {
    /**
     * Check if a key is within its rate limit.
     * Consumes one token if allowed.
     * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
     */
    check(key) {
      const now = Date.now();
      let bucket = buckets.get(key);

      if (!bucket || now - bucket.windowStart >= windowMs) {
        bucket = { tokens: maxTokens, windowStart: now, lastUsed: now };
        buckets.set(key, bucket);
      }

      bucket.lastUsed = now;

      if (bucket.tokens > 0) {
        bucket.tokens--;
        return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
      }

      const retryAfterMs = windowMs - (now - bucket.windowStart);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    },

    /**
     * Reset rate limit for a key (e.g. after owner override).
     */
    reset(key) {
      buckets.delete(key);
    },

    /**
     * Current tracking stats.
     */
    stats() {
      return { trackedKeys: buckets.size, maxTokens, windowMs };
    },

    /**
     * Destroy the limiter — clears the cleanup timer and all buckets.
     */
    destroy() {
      clearInterval(cleanupTimer);
      buckets.clear();
    },
  };
}

/* ── Pre-configured limiters ───────────────────────────────────────────── */

/** AI requests: 15 per minute per user */
export const aiLimiter = createRateLimiter({ maxTokens: 15, windowMs: 60_000 });

/** Media downloads: 5 per minute per user */
export const mediaLimiter = createRateLimiter({ maxTokens: 5, windowMs: 60_000 });

/** Image search: 10 per minute per user */
export const imageLimiter = createRateLimiter({ maxTokens: 10, windowMs: 60_000 });
